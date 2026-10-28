import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Modal, PageHead, Panel, useToast } from '../../components/ui/index.jsx';
import { supabase } from '../../lib/supabase.js';
import {
  deleteEvent, fetchEvents, fetchStoreLocation, geocodeStore, refreshForecast, saveEvent, saveLocation, setEventStatus, syncEvents,
} from '../../lib/events.js';

const SCALE = { small: '작음', medium: '보통', large: '큼' };
const STATUS_TONE = { 제안: 'orange', 반영: 'green', 제외: 'gray' };
const EMPTY = { title: '', start_date: '', end_date: '', start_time: '', end_time: '', scale: 'medium', uplift_percent: '' };

const dateText = (e) => (e.start_date === e.end_date ? e.start_date.slice(5) : `${e.start_date.slice(5)} ~ ${e.end_date.slice(5)}`).replace(/-/g, '.');
const timeText = (e) => (e.start_time ? `${e.start_time.slice(0, 5)}~${(e.end_time || '').slice(0, 5)}` : '종일');
// 화면 표시용 가산율(점주가 정한 값이 없으면 서버 기본표 값이 적용된다)
const upliftText = (e) => (e.uplift_rate == null ? '기본표' : `+${Math.round(Number(e.uplift_rate) * 100)}%`);

export function EventsPage() {
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [loc, setLoc] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(null); // null = 닫힘
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      const [ev, store] = await Promise.all([fetchEvents(), fetchStoreLocation()]);
      setEvents(ev); setLoc(store); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { if (supabase) load(); }, [load]);

  const run = async (key, fn, done) => {
    setBusy(key);
    try { const r = await fn(); await load(); toast?.(typeof done === 'function' ? done(r) : done); }
    catch (e) { toast?.(e.message); }
    finally { setBusy(''); }
  };

  if (!supabase) {
    return (
      <>
        <PageHead eyebrow="1-3" title="주변 행사" desc="매장 주변 행사를 예측과 발주에 반영합니다." />
        <EmptyState icon="calendar" title="DB에 연결된 상태에서만 사용할 수 있습니다" />
      </>
    );
  }

  const hasLoc = loc?.latitude != null;
  const submit = async () => {
    if (!form.title.trim() || !form.start_date || !form.end_date) { setFormError('행사 이름과 기간을 입력하세요.'); return; }
    if (form.end_date < form.start_date) { setFormError('종료일은 시작일보다 빠를 수 없습니다.'); return; }
    if ((form.start_time && !form.end_time) || (!form.start_time && form.end_time)) { setFormError('시작·종료 시간을 함께 입력하거나 둘 다 비우세요.'); return; }
    const percent = form.uplift_percent === '' ? null : Number(form.uplift_percent);
    if (percent !== null && !(percent >= 0 && percent <= 30)) { setFormError('가산율은 0~30% 사이로 입력하세요.'); return; }
    setBusy('save');
    try {
      await saveEvent({ ...form, uplift_rate: percent === null ? null : percent / 100, status: '반영' });
      setForm(null); setFormError(''); await load(); toast?.('행사를 등록했습니다. 예측을 다시 계산하면 반영됩니다.');
    } catch (e) { setFormError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <>
      <PageHead eyebrow="1-3 · 이벤트 E4" title="주변 행사"
        desc="매장 근처 행사를 찾아 다음 주 예상 매출과 권장 발주량에 반영합니다. '반영'으로 바꾼 행사만 예측에 들어갑니다."
        actions={<Button icon="plus" onClick={() => { setForm({ ...EMPTY }); setFormError(''); }}>행사 직접 등록</Button>} />

      {error && <Alert tone="danger" title="행사를 불러오지 못했습니다">{error}</Alert>}

      <Panel title="매장 위치" meta={hasLoc ? `반경 ${loc.event_radius_m}m` : '미등록'}>
        {hasLoc
          ? <p>{loc.address || '주소 없음'} · 위도 {Number(loc.latitude).toFixed(4)}, 경도 {Number(loc.longitude).toFixed(4)}</p>
          : <Alert tone="warning" title="매장 위치가 없어 자동 불러오기를 쓸 수 없습니다">매장 주소를 좌표로 바꿔 저장하세요. 행사를 직접 등록하는 것은 위치 없이도 됩니다.</Alert>}
        <div className="row-actions">
          <Button variant="secondary" disabled={busy === 'geo'}
            onClick={() => run('geo', geocodeStore, '매장 위치를 저장했습니다.')}>{hasLoc ? '주소로 위치 다시 찾기' : '주소로 위치 찾기'}</Button>
          <Button disabled={busy === 'sync' || !hasLoc}
            onClick={() => run('sync', () => syncEvents(28), (r) => `행사 ${r.fetched}건을 확인해 새 행사 ${r.added}건을 추가했습니다.${r.errors?.length ? ` (일부 출처 실패: ${r.errors.join(', ')})` : ''}`)}>주변 행사 불러오기</Button>
        </div>
      </Panel>

      <Panel title="앞으로의 행사" meta={events ? `${events.length}건` : ''}
        actions={<Button variant="secondary" icon="refresh" disabled={busy === 'refresh'}
          onClick={() => run('refresh', refreshForecast, '다음 주 예측과 권장 발주량을 다시 계산했습니다.')}>예측·발주 다시 계산</Button>}>
        {events === null && !error && <p role="status">불러오는 중…</p>}
        {events?.length === 0 && <EmptyState icon="calendar" title="등록된 행사가 없습니다">주변 행사를 불러오거나 직접 등록하세요.</EmptyState>}
        {events?.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>행사</th><th>날짜</th><th>시간</th><th>거리</th><th>규모</th><th>가산</th><th>상태</th><th /></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.event_id}>
                    <td>{e.title}{e.source === 'manual' && <> <Badge>직접</Badge></>}</td>
                    <td>{dateText(e)}</td><td>{timeText(e)}</td>
                    <td>{e.distance_m == null ? '-' : `${e.distance_m}m`}</td>
                    <td>{SCALE[e.scale]}</td><td>{upliftText(e)}</td>
                    <td><Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge></td>
                    <td className="row-actions">
                      {e.status !== '반영' && <Button size="sm" disabled={!!busy} onClick={() => run(`s${e.event_id}`, () => setEventStatus(e.event_id, '반영'), '반영으로 바꿨습니다. 예측을 다시 계산하세요.')}>반영</Button>}
                      {e.status !== '제외' && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run(`s${e.event_id}`, () => setEventStatus(e.event_id, '제외'), '제외했습니다. 예측을 다시 계산하세요.')}>제외</Button>}
                      {e.source === 'manual' && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run(`d${e.event_id}`, () => deleteEvent(e.event_id), '삭제했습니다.')}>삭제</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="help">가산 '기본표'는 거리·규모로 정해지는 시작값(최대 +30%)이며, 같은 규모 행사가 2건 이상 끝나면 이 매장의 실제 증가율로 바뀝니다.</p>
      </Panel>

      {form && (
        <Modal title="행사 직접 등록" desc="API에 없는 학교 축제·동네 행사 등을 입력합니다." onClose={() => setForm(null)}
          footer={<><Button variant="secondary" onClick={() => setForm(null)}>취소</Button><Button disabled={busy === 'save'} onClick={submit}>등록</Button></>}>
          {formError && <Alert tone="danger" title="입력을 확인하세요">{formError}</Alert>}
          <Field id="ev-title" label="행사 이름" required><input id="ev-title" data-autofocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></Field>
          <Field id="ev-start" label="시작일" required><input id="ev-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: form.end_date || e.target.value })} /></Field>
          <Field id="ev-end" label="종료일" required><input id="ev-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <Field id="ev-st" label="시작 시간" help="비우면 하루 종일로 봅니다."><input id="ev-st" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></Field>
          <Field id="ev-et" label="종료 시간"><input id="ev-et" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field>
          <Field id="ev-scale" label="규모"><select id="ev-scale" value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })}>
            <option value="small">작음</option><option value="medium">보통</option><option value="large">큼</option></select></Field>
          <Field id="ev-up" label="매출 가산율(%)" help="비우면 규모에 따른 기본값을 씁니다. 0~30."><input id="ev-up" type="number" min="0" max="30" value={form.uplift_percent} onChange={(e) => setForm({ ...form, uplift_percent: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}
