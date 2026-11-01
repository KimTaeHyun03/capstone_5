import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

// 서비스 키는 Edge 환경에서만 읽는다. 요청의 store_id/role/email은 신뢰하지 않는다.
const url = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const appUrl = Deno.env.get('APP_URL');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  const allowedOrigin = appUrl ? new URL(appUrl).origin : '';
  const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!appUrl) return reply({ error: 'Edge Function APP_URL 설정이 필요합니다.' }, 503);
  if (origin && origin !== allowedOrigin) return reply({ error: '허용되지 않은 출처입니다.' }, 403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ error: 'POST 요청만 허용합니다.' }, 405);
  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: '로그인이 필요합니다.' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply({ error: '유효하지 않은 로그인입니다.' }, 401);
    const { data: actor, error: actorError } = await admin.from('user_account').select('user_id,store_id,role,status').eq('auth_user_id',auth.user.id).single();
    if (actorError || actor.role !== '점주' || actor.status !== '활성') return reply({ error: '활성 점주만 직원을 초대할 수 있습니다.' }, 403);
    const { user_id } = await request.json();
    if (!Number.isSafeInteger(Number(user_id))) return reply({ error: '직원 ID를 확인하세요.' }, 400);
    const { data: employee, error: employeeError } = await admin.from('user_account').select('user_id,email,name,role,status,auth_user_id').eq('user_id',user_id).eq('store_id',actor.store_id).single();
    if (employeeError || employee.role === '점주' || !employee.email || employee.status === '비활성') return reply({ error: '초대 가능한 같은 매장 직원이 아닙니다.' }, 400);
    if (employee.auth_user_id) return reply({ error: '이미 로그인 계정에 연결된 직원입니다.' }, 409);
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(employee.email, { redirectTo: appUrl });
    if (inviteError) return reply({ error: `초대 발송 실패: ${inviteError.message}` }, 400);
    const { data: linked, error: linkError } = await admin.from('user_account').update({ auth_user_id: invitation.user.id }).eq('user_id',employee.user_id).eq('store_id',actor.store_id).eq('email',employee.email).is('auth_user_id',null).select('user_id').single();
    if (linkError || !linked) return reply({ error: '초대 메일은 발송되었지만 계정 연결에 실패했습니다. 관리자가 Auth 사용자와 직원 계정을 연결해야 합니다.' }, 409);
    return reply({ ok: true });
  } catch {
    return reply({ error: '초대 처리에 실패했습니다. 입력값과 서버 설정을 확인하세요.' }, 400);
  }
});
