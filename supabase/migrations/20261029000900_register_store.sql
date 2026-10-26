-- 점주 온보딩: 가입한(Auth) 사용자가 아직 어느 매장에도 속해 있지 않으면 스스로 매장을 만들고 그 매장의 점주가 된다.
-- 직원(매니저·알바생)은 점주가 초대하므로 이 함수를 쓰지 않는다. 초대된 이메일로 가입한 사용자는 이미 user_account 와 연결돼 있어 거부된다.
-- 테이블은 추가하지 않는다(22개 유지). store 와 user_account 에 한 행씩 만든다.
create or replace function public.register_store(
  p_store_name text, p_owner_name text,
  p_address text default null, p_phone text default null,
  p_open time default '08:00', p_close time default '22:00')
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_auth  uuid := auth.uid();
  v_email text;
  v_store bigint;
begin
  if v_auth is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  if exists (select 1 from user_account where auth_user_id = v_auth) then
    raise exception '이미 매장에 등록된 계정입니다.';
  end if;
  select lower(email) into v_email from auth.users where id = v_auth;
  if v_email is null then
    raise exception '이메일을 확인할 수 없는 계정입니다.';
  end if;
  if exists (select 1 from user_account where lower(login_id) = v_email or lower(email) = v_email) then
    raise exception '이 이메일은 이미 직원으로 등록돼 있습니다. 점주에게 초대를 요청하세요.';
  end if;

  p_store_name := btrim(coalesce(p_store_name, ''));
  p_owner_name := btrim(coalesce(p_owner_name, ''));
  if p_store_name = '' or length(p_store_name) > 100 then raise exception '매장 이름은 1~100자로 입력하세요.'; end if;
  if p_owner_name = '' or length(p_owner_name) > 50 then raise exception '점주 이름은 1~50자로 입력하세요.'; end if;
  if p_open is null or p_close is null or p_open >= p_close then raise exception '영업 종료 시각은 시작 시각보다 늦어야 합니다.'; end if;
  if length(coalesce(p_address, '')) > 255 or length(coalesce(p_phone, '')) > 20 then raise exception '주소 또는 전화번호가 너무 깁니다.'; end if;

  insert into store (store_name, address, phone, open_time, close_time, closed_days)
  values (p_store_name, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), p_open, p_close, '없음')
  returning store_id into v_store;

  insert into user_account (store_id, login_id, email, password_hash, name, role, status, auth_user_id)
  values (v_store, v_email, v_email, null, p_owner_name, '점주', '활성', v_auth);

  return v_store;
end $$;

comment on function public.register_store(text, text, text, text, time, time) is '점주 온보딩: 매장을 만들고 호출한 가입 사용자를 그 매장의 점주로 등록';
revoke all on function public.register_store(text, text, text, text, time, time) from public, anon;
grant execute on function public.register_store(text, text, text, text, time, time) to authenticated;
