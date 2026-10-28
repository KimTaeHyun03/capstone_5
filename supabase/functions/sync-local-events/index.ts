import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

// 주변 행사 수집(점주 화면의 '주변 행사 불러오기' · 매장 위치 등록).
//  - action 'geocode': 매장 주소를 좌표로 바꿔 저장(카카오 로컬 API). 저장은 점주 권한의 RPC(set_store_location)로 한다.
//  - action 'sync'   : 공공 행사 API 2종(공공데이터포털 전국공연행사정보·전국문화축제 표준데이터)에서 앞으로 N일 안의 행사를 받아 local_event 에 '제안' 상태로 저장.
//                      반경 필터와 거리 계산은 DB 함수(upsert_synced_events)가 한다.
// 키(PUBLIC_EVENT_API_KEY, KAKAO_REST_API_KEY)는 Edge 환경 secret 에서만 읽는다. 요청의 store_id 는 신뢰하지 않고 로그인 토큰으로 정한다.
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const appUrl = Deno.env.get('APP_URL');
const eventKey = Deno.env.get('PUBLIC_EVENT_API_KEY');
const kakaoKey = Deno.env.get('KAKAO_REST_API_KEY');
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function geocode(address: string) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`, {
    headers: { Authorization: `KakaoAK ${kakaoKey}` },
  });
  if (!res.ok) throw new Error(`주소를 좌표로 바꾸지 못했습니다. (${res.status})`);
  const doc = (await res.json()).documents?.[0];
  if (!doc) throw new Error('주소를 찾지 못했습니다. 주소를 확인하세요.');
  return { lat: Number(doc.y), lon: Number(doc.x) };
}

// 응답 필드 이름이 문서와 다를 수 있어 후보를 여러 개 받아 준다.
const pick = (it: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (it[k] !== undefined && it[k] !== null && String(it[k]).trim() !== '') return String(it[k]).trim();
  return undefined;
};
const dateOf = (s?: string) => (s && /^\d{4}-?\d{2}-?\d{2}/.test(s) ? s.replace(/^(\d{4})-?(\d{2})-?(\d{2}).*/, '$1-$2-$3') : null);
const timeOf = (s?: string) => (s && /^\d{1,2}:?\d{2}/.test(s) ? s.replace(/^(\d{1,2}):?(\d{2}).*/, (_, h, m) => `${h.padStart(2, '0')}:${m}`) : null);

// 행사 출처(공공데이터포털). 같은 서비스키를 쓴다. 응답은 모두 최상위 body.items.item[] (response 래퍼 없음).
//  - 공연·행사: tn_pubr_public_pblprfr_event_info_api (시간 있음)
//  - 문화축제 : tn_pubr_public_cltur_fstvl_api (종일, 한국관광공사 등록)
const SOURCES = [
  { key: 'perf', label: '공연·행사', url: Deno.env.get('PUBLIC_EVENT_API_URL') || 'https://api.data.go.kr/openapi/tn_pubr_public_pblprfr_event_info_api',
    title: ['eventNm'], start: ['eventStartDate'], end: ['eventEndDate'], startTime: ['eventStartTime'], endTime: ['eventEndTime'] },
  { key: 'fstvl', label: '문화축제', url: Deno.env.get('PUBLIC_FESTIVAL_API_URL') || 'https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api',
    title: ['fstvlNm'], start: ['fstvlStartDate'], end: ['fstvlEndDate'], startTime: [] as string[], endTime: [] as string[] },
];

async function fetchSource(src: typeof SOURCES[number], todayIso: string, lastIso: string, lat: number, lon: number, radiusM: number) {
  // 위도 1도 ≈ 111km. 반경보다 넉넉한 사각형으로 먼저 걸러 DB 로 보내는 양을 줄인다(정확한 거리는 DB 가 계산).
  const dLat = (radiusM * 2) / 111000, dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const events: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let page = 1; page <= 30; page++) {
    const q = new URLSearchParams({ serviceKey: eventKey!, pageNo: String(page), numOfRows: String(PAGE), type: 'json' });
    const res = await fetch(`${src.url}?${q}`);
    if (!res.ok) throw new Error(`${src.label} API 응답 오류 (${res.status})`);
    const body = await res.json().catch(() => null);
    if (!body) throw new Error(`${src.label} API 응답을 읽지 못했습니다.`);
    const data = body?.response?.body ?? body?.body;
    const raw = data?.items;
    const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
    for (const it of items) {
      const start = dateOf(pick(it, ...src.start));
      const end = dateOf(pick(it, ...src.end)) ?? start;
      const la = Number(pick(it, 'latitude')), lo = Number(pick(it, 'longitude'));
      const title = pick(it, ...src.title);
      if (!title || !start || !end || end < todayIso || start > lastIso) continue;
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !la || !lo) continue; // 좌표 없는 행사는 거리를 알 수 없어 제외
      if (Math.abs(la - lat) > dLat || Math.abs(lo - lon) > dLon) continue;
      const startTime = timeOf(pick(it, ...src.startTime)), endTime = timeOf(pick(it, ...src.endTime));
      events.push({
        external_id: `${src.key}|${title}|${start}|${pick(it, 'opar') ?? ''}`.slice(0, 100), title, start_date: start, end_date: end,
        start_time: startTime && endTime ? startTime : null, end_time: startTime && endTime ? endTime : null, latitude: la, longitude: lo,
      });
    }
    const total = Number(data?.totalCount ?? 0);
    if (items.length < PAGE || (total && page * PAGE >= total)) break;
  }
  return events;
}

// 두 출처를 모두 불러온다. 한쪽이 실패해도 나머지 결과는 쓰고, 실패한 출처 이름을 errors 로 알린다.
async function fetchEvents(days: number, lat: number, lon: number, radiusM: number) {
  const todayIso = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const lastIso = new Date(Date.now() + 9 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
  const settled = await Promise.allSettled(SOURCES.map((s) => fetchSource(s, todayIso, lastIso, lat, lon, radiusM)));
  const events: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') { events.push(...r.value); counts[SOURCES[i].label] = r.value.length; }
    else errors.push(r.reason instanceof Error ? r.reason.message : `${SOURCES[i].label} 불러오기 실패`);
  });
  if (!events.length && errors.length === SOURCES.length) throw new Error(errors.join(' / '));
  return { events, errors, counts };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const allowed = new Set<string>();
  if (appUrl) allowed.add(new URL(appUrl).origin);
  for (const o of (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean)) allowed.add(o);
  const cors = { 'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : '', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!allowed.size) return reply({ error: 'Edge Function APP_URL 설정이 필요합니다.' }, 503);
  if (origin && !allowed.has(origin)) return reply({ error: '허용되지 않은 출처입니다.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'POST 요청만 허용합니다.' }, 405);

  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: '로그인이 필요합니다.' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: '유효하지 않은 로그인입니다.' }, 401);
    const { data: actor, error: actorError } = await admin.from('user_account').select('store_id,role,status').eq('auth_user_id', auth.user.id).maybeSingle();
    if (actorError || !actor || actor.role !== '점주' || actor.status !== '활성') return reply({ error: '활성 점주만 사용할 수 있습니다.' }, 403);

    const { action, days } = await request.json().catch(() => ({}));
    const { data: store } = await admin.from('store').select('address,latitude,longitude').eq('store_id', actor.store_id).single();

    if (action === 'geocode') {
      if (!kakaoKey) return reply({ error: '주소 변환이 아직 설정되지 않았습니다. (KAKAO_REST_API_KEY 필요)', code: 'not_configured' }, 503);
      if (!store?.address) return reply({ error: '매장 주소가 비어 있습니다. 매장 정보에서 주소를 먼저 입력하세요.', code: 'no_address' }, 422);
      const { lat, lon } = await geocode(store.address);
      // 점주 본인의 권한으로 저장한다(함수가 점주 여부를 다시 확인).
      const asUser = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
      const { error } = await asUser.rpc('set_store_location', { p_lat: lat, p_lon: lon, p_radius: null });
      if (error) return reply({ error: error.message }, 400);
      return reply({ latitude: lat, longitude: lon });
    }

    if (action === 'sync') {
      if (!eventKey) return reply({ error: '행사 불러오기가 아직 설정되지 않았습니다. (PUBLIC_EVENT_API_KEY 필요)', code: 'not_configured' }, 503);
      if (store?.latitude == null) return reply({ error: '매장 위치가 아직 없습니다. 먼저 매장 위치를 등록하세요.', code: 'no_location' }, 422);
      const { data: rad } = await admin.from('store').select('event_radius_m').eq('store_id', actor.store_id).single();
      const { events, errors, counts } = await fetchEvents(Math.min(Math.max(Number(days) || 28, 7), 60), Number(store.latitude), Number(store.longitude), rad?.event_radius_m ?? 1000);
      const { data: added, error } = await admin.rpc('upsert_synced_events', { p_store: actor.store_id, p_events: events });
      if (error) return reply({ error: error.message }, 400);
      return reply({ fetched: events.length, added, counts, errors });
    }
    return reply({ error: '지원하지 않는 동작입니다.' }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : '행사를 불러오지 못했습니다.' }, 502);
  }
});
