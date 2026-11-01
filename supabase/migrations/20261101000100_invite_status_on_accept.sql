-- 직원 초대: 메일을 보낸 것만으로 '활성'이 되던 문제 수정
-- 초대 메일을 실제로 수락(이메일 확인)한 시점에 '초대됨' -> '활성'으로 바꾼다.
create or replace function app.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null then
    -- 아직 연결되지 않은 계정은 이메일(login_id)로 연결 (점주 가입·시드 계정)
    update public.user_account
       set auth_user_id = new.id,
           status = case when status = '초대됨' then '활성' else status end
     where lower(login_id) = lower(new.email)
       and auth_user_id is null;
    -- 초대 시 이미 연결된 직원 계정은 수락 시점에 활성화
    update public.user_account
       set status = '활성'
     where auth_user_id = new.id
       and status = '초대됨';
  end if;
  return new;
end $$;

-- 수락하지 않았는데 '활성'으로 바뀌어 있던 직원은 '초대됨'으로 되돌린다 (점주 제외)
update public.user_account u
   set status = '초대됨'
  from auth.users a
 where u.auth_user_id = a.id
   and a.email_confirmed_at is null
   and u.role <> '점주'
   and u.status = '활성';
