-- =====================================================================
-- 0단계 · 시드 계정 로그인ID → 로그인 이메일 전환
-- 예전 seed.sql(login_id 'owner' 등)이 들어 있는 DB 용. 새로 만드는 DB 에서는 바뀌는 행이 없다.
-- 이후 같은 이메일로 Supabase Auth 사용자를 만들면 트리거(app.link_auth_user)가 자동 연결한다.
-- =====================================================================
update user_account
   set login_id = login_id || '@example.com',
       password_hash = null
 where login_id in ('owner', 'jang', 'jung', 'park', 'lee', 'choi', 'han');

-- 이미 만들어 둔 인증 사용자가 있으면 연결
update user_account u
   set auth_user_id = a.id
  from auth.users a
 where lower(u.login_id) = lower(a.email)
   and a.email_confirmed_at is not null
   and u.auth_user_id is null;
