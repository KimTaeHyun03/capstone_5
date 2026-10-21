-- =====================================================================
-- 0~2단계 되돌리기 — 20261021* 마이그레이션 적용 후 문제가 생겼을 때만 SQL Editor 에서 실행
-- 정책·함수·트리거를 지우고 예전 anon 읽기 정책(10개 테이블)을 되살린다.
-- user_account.auth_user_id 컬럼과 이메일로 바뀐 login_id 는 그대로 둔다 (데이터 보존).
-- =====================================================================
begin;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop trigger if exists on_auth_user_link on auth.users;
drop function if exists public.generate_sales_forecast(date, integer);
drop schema if exists app cascade;

grant select, insert, update on user_account to anon, authenticated;

create policy "anon read store"                  on store                  for select to anon using (true);
create policy "anon read menu"                   on menu                   for select to anon using (true);
create policy "anon read ingredient"             on ingredient             for select to anon using (true);
create policy "anon read recipe"                 on recipe                 for select to anon using (true);
create policy "anon read inventory"              on inventory              for select to anon using (true);
create policy "anon read sales_summary"          on sales_summary          for select to anon using (true);
create policy "anon read sales_forecast"         on sales_forecast         for select to anon using (true);
create policy "anon read correction_coefficient" on correction_coefficient for select to anon using (true);
create policy "anon read order_recommendation"   on order_recommendation   for select to anon using (true);
create policy "anon read purchase_order"         on purchase_order         for select to anon using (true);

commit;
