-- =====================================================================
-- 0단계 · 인증(Supabase Auth) 연결 + RLS 정비
-- 실행: 20261014000000_init_22_tables.sql 다음에 실행 (seed.sql 보다 먼저)
-- - 테이블은 추가하지 않는다. user_account 에 auth_user_id 컬럼만 추가한다.
-- - 로그인은 Supabase Auth(이메일/비밀번호). user_account.login_id 에 이메일을 넣으면
--   같은 이메일의 인증 사용자가 확인(confirmed)되는 순간 자동으로 연결된다.
-- - anon(로그인 안 한 사용자)은 어떤 테이블도 읽지 못한다. 모든 접근은 같은 매장(store_id)으로 제한한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. user_account ↔ auth.users 연결
-- ---------------------------------------------------------------------
alter table user_account add column auth_user_id uuid unique references auth.users (id) on delete set null;
alter table user_account alter column password_hash drop not null;

comment on column user_account.auth_user_id is '인증 사용자ID(Supabase Auth, FK)';
comment on column user_account.login_id is '로그인ID(이메일)';
comment on column user_account.password_hash is '사용하지 않음(Supabase Auth 가 비밀번호 관리)';

-- 내부 함수용 스키마 (API 로 노출되지 않는다)
create schema if not exists app;
grant usage on schema app to authenticated;

-- 이메일이 확인된 인증 사용자를 login_id 가 같은 계정에 연결하고, '초대됨'이면 '활성'으로 바꾼다 (7-1 E1 이후 단계)
create or replace function app.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null then
    update public.user_account
       set auth_user_id = new.id,
           status = case when status = '초대됨' then '활성' else status end
     where lower(login_id) = lower(new.email)
       and auth_user_id is null;
  end if;
  return new;
end $$;

create trigger on_auth_user_link
  after insert or update of email_confirmed_at on auth.users
  for each row execute function app.link_auth_user();

-- 이미 만들어 둔 인증 사용자도 연결
update user_account u
   set auth_user_id = a.id
  from auth.users a
 where lower(u.login_id) = lower(a.email)
   and a.email_confirmed_at is not null
   and u.auth_user_id is null;

-- ---------------------------------------------------------------------
-- 2. RLS 헬퍼 — security definer 라서 정책 안에서 user_account RLS 를 다시 타지 않는다
-- ---------------------------------------------------------------------
create or replace function app.my_user_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select user_id from public.user_account where auth_user_id = auth.uid() and status = '활성'
$$;

create or replace function app.my_store_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select store_id from public.user_account where auth_user_id = auth.uid() and status = '활성'
$$;

create or replace function app.my_role() returns varchar
language sql stable security definer set search_path = '' as $$
  select role from public.user_account where auth_user_id = auth.uid() and status = '활성'
$$;

create or replace function app.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() = '점주', false)
$$;

-- 점주 또는 매니저
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() in ('점주', '매니저'), false)
$$;

create or replace function app.user_in_store(p_user_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_account where user_id = p_user_id and store_id = app.my_store_id())
$$;

create or replace function app.menu_in_store(p_menu_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.menu where menu_id = p_menu_id and store_id = app.my_store_id())
$$;

create or replace function app.ingredient_in_store(p_ingredient_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ingredient where ingredient_id = p_ingredient_id and store_id = app.my_store_id())
$$;

create or replace function app.schedule_in_store(p_schedule_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_schedule where schedule_id = p_schedule_id and store_id = app.my_store_id())
$$;

create or replace function app.schedule_published(p_schedule_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_schedule where schedule_id = p_schedule_id and store_id = app.my_store_id() and is_published)
$$;

create or replace function app.order_in_store(p_order_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.purchase_order where order_id = p_order_id and app.ingredient_in_store(ingredient_id))
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------------
-- 3. 정책 — 기존 anon 읽기 정책 제거
-- ---------------------------------------------------------------------
drop policy "anon read store"                  on store;
drop policy "anon read menu"                   on menu;
drop policy "anon read ingredient"             on ingredient;
drop policy "anon read recipe"                 on recipe;
drop policy "anon read inventory"              on inventory;
drop policy "anon read sales_summary"          on sales_summary;
drop policy "anon read sales_forecast"         on sales_forecast;
drop policy "anon read correction_coefficient" on correction_coefficient;
drop policy "anon read order_recommendation"   on order_recommendation;
drop policy "anon read purchase_order"         on purchase_order;

-- 역할 요약: 점주 = 매장 데이터 전체 쓰기 / 매니저 = 스케줄 검토·재고·입고·신고 처리 / 알바생 = 본인 가능시간·출퇴근·부족 신고
-- 같은 테이블의 정책 여러 개는 OR 로 합쳐진다.

-- 기초 정보 -------------------------------------------------------------
create policy "member read store" on store for select to authenticated
  using (store_id = app.my_store_id());
create policy "owner update store" on store for update to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id());

-- user_account: password_hash·auth_user_id 는 클라이언트가 쓰지 못하게 컬럼 권한으로 막는다
revoke select, insert, update on user_account from anon, authenticated;
grant select (user_id, store_id, login_id, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status, auth_user_id)
  on user_account to authenticated;
grant insert (store_id, login_id, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status)
  on user_account to authenticated;
grant update (login_id, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status)
  on user_account to authenticated;
create policy "member read user_account" on user_account for select to authenticated
  using (store_id = app.my_store_id());
create policy "owner insert user_account" on user_account for insert to authenticated
  with check (store_id = app.my_store_id() and app.is_owner());
create policy "owner update user_account" on user_account for update to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id());

create policy "member read menu" on menu for select to authenticated
  using (store_id = app.my_store_id());
create policy "owner write menu" on menu for all to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id() and app.is_owner());

create policy "member read ingredient" on ingredient for select to authenticated
  using (store_id = app.my_store_id());
create policy "owner write ingredient" on ingredient for all to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id() and app.is_owner());

create policy "member read recipe" on recipe for select to authenticated
  using (app.menu_in_store(menu_id));
create policy "owner write recipe" on recipe for all to authenticated
  using (app.menu_in_store(menu_id) and app.is_owner())
  with check (app.menu_in_store(menu_id) and app.ingredient_in_store(ingredient_id) and app.is_owner());

-- 매출 (점주·매니저만 조회) ---------------------------------------------
create policy "admin read sale" on sale for select to authenticated
  using (app.menu_in_store(menu_id) and app.is_admin());
create policy "owner write sale" on sale for all to authenticated
  using (app.menu_in_store(menu_id) and app.is_owner())
  with check (app.menu_in_store(menu_id) and app.is_owner());

create policy "admin read sales_summary" on sales_summary for select to authenticated
  using (store_id = app.my_store_id() and app.is_admin());
create policy "owner write sales_summary" on sales_summary for all to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id() and app.is_owner());

create policy "admin read sales_forecast" on sales_forecast for select to authenticated
  using (store_id = app.my_store_id() and app.is_admin());
create policy "owner write sales_forecast" on sales_forecast for all to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id() and app.is_owner());

-- 스케줄 ---------------------------------------------------------------
create policy "read availability" on availability for select to authenticated
  using (user_id = app.my_user_id() or (app.is_admin() and app.user_in_store(user_id)));
create policy "self write availability" on availability for all to authenticated
  using (user_id = app.my_user_id())
  with check (user_id = app.my_user_id());
create policy "owner write availability" on availability for all to authenticated
  using (app.user_in_store(user_id) and app.is_owner())
  with check (app.user_in_store(user_id) and app.is_owner());

create policy "read work_schedule" on work_schedule for select to authenticated
  using (store_id = app.my_store_id() and (app.is_admin() or is_published));
create policy "owner write work_schedule" on work_schedule for all to authenticated
  using (store_id = app.my_store_id() and app.is_owner())
  with check (store_id = app.my_store_id() and app.is_owner());
create policy "manager update work_schedule" on work_schedule for update to authenticated
  using (store_id = app.my_store_id() and app.my_role() = '매니저')
  with check (store_id = app.my_store_id());

create policy "read shift_assignment" on shift_assignment for select to authenticated
  using ((app.is_admin() and app.schedule_in_store(schedule_id)) or app.schedule_published(schedule_id));
create policy "admin write shift_assignment" on shift_assignment for all to authenticated
  using (app.is_admin() and app.schedule_in_store(schedule_id))
  with check (app.is_admin() and app.schedule_in_store(schedule_id) and app.user_in_store(user_id));

-- 근태·급여 ------------------------------------------------------------
create policy "read attendance" on attendance for select to authenticated
  using (user_id = app.my_user_id() or (app.is_admin() and app.user_in_store(user_id)));
create policy "self insert attendance" on attendance for insert to authenticated
  with check (user_id = app.my_user_id());
create policy "self update attendance" on attendance for update to authenticated
  using (user_id = app.my_user_id())
  with check (user_id = app.my_user_id());
create policy "owner write attendance" on attendance for all to authenticated
  using (app.user_in_store(user_id) and app.is_owner())
  with check (app.user_in_store(user_id) and app.is_owner());

create policy "read payroll" on payroll for select to authenticated
  using (user_id = app.my_user_id() or (app.is_admin() and app.user_in_store(user_id)));
create policy "owner write payroll" on payroll for all to authenticated
  using (app.user_in_store(user_id) and app.is_owner())
  with check (app.user_in_store(user_id) and app.is_owner());

-- 재고 -----------------------------------------------------------------
create policy "member read inventory" on inventory for select to authenticated
  using (app.ingredient_in_store(ingredient_id));
create policy "admin write inventory" on inventory for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin())
  with check (app.ingredient_in_store(ingredient_id) and app.is_admin());

create policy "admin read inventory_change" on inventory_change for select to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin());
create policy "admin write inventory_change" on inventory_change for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin())
  with check (app.ingredient_in_store(ingredient_id) and app.is_admin());

create policy "member read shortage_report" on shortage_report for select to authenticated
  using (app.ingredient_in_store(ingredient_id));
create policy "self insert shortage_report" on shortage_report for insert to authenticated
  with check (reporter_id = app.my_user_id() and app.ingredient_in_store(ingredient_id));
create policy "admin update shortage_report" on shortage_report for update to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin())
  with check (app.ingredient_in_store(ingredient_id));

create policy "self read notification" on notification for select to authenticated
  using (recipient_id = app.my_user_id());
create policy "self update notification" on notification for update to authenticated
  using (recipient_id = app.my_user_id())
  with check (recipient_id = app.my_user_id());
create policy "member insert notification" on notification for insert to authenticated
  with check (app.user_in_store(recipient_id));

-- 발주·보정 (점주·매니저) ----------------------------------------------
create policy "admin read forecast_error" on forecast_error for select to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin());
create policy "owner write forecast_error" on forecast_error for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_owner())
  with check (app.ingredient_in_store(ingredient_id) and app.is_owner());

create policy "admin read correction_coefficient" on correction_coefficient for select to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin());
create policy "owner write correction_coefficient" on correction_coefficient for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_owner())
  with check (app.ingredient_in_store(ingredient_id) and app.is_owner());

create policy "admin read order_recommendation" on order_recommendation for select to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin());
create policy "owner write order_recommendation" on order_recommendation for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_owner())
  with check (app.ingredient_in_store(ingredient_id) and app.is_owner());

create policy "admin read purchase_order" on purchase_order for select to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_admin());
create policy "owner write purchase_order" on purchase_order for all to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.is_owner())
  with check (app.ingredient_in_store(ingredient_id) and app.is_owner());
create policy "manager update purchase_order" on purchase_order for update to authenticated
  using (app.ingredient_in_store(ingredient_id) and app.my_role() = '매니저')
  with check (app.ingredient_in_store(ingredient_id));

create policy "admin read receipt" on receipt for select to authenticated
  using (app.order_in_store(order_id) and app.is_admin());
create policy "admin insert receipt" on receipt for insert to authenticated
  with check (app.order_in_store(order_id) and app.is_admin() and handled_by = app.my_user_id());
create policy "owner write receipt" on receipt for all to authenticated
  using (app.order_in_store(order_id) and app.is_owner())
  with check (app.order_in_store(order_id) and app.is_owner());
