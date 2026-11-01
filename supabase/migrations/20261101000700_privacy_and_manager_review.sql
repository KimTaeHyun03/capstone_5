-- 개인정보·권한 정리
--  4. 직원 정보: 점주만 전체를 읽고, 그 밖에는 본인 행만 읽는다. 동료 이름·역할은 staff_directory 로 본다.
--  5. 급여·출퇴근은 점주가 화면 밖에서 직접 쓰지 못하게 하고(함수 경유만), 급여 조회는 점주와 본인만 한다.
--  6. 매니저는 근무표를 조회하고 검토 완료(+의견)만 한다. 배정·상태 변경은 점주만 한다.

-- ---------------------------------------------------------------------
-- 4. user_account
-- ---------------------------------------------------------------------
drop policy if exists "member read user_account" on public.user_account;
create policy "owner read user_account" on public.user_account
  for select to authenticated using (store_id = app.my_store_id() and app.is_owner());
create policy "self read user_account" on public.user_account
  for select to authenticated using (auth_user_id = auth.uid());

-- 이름·역할·상태만 보이는 같은 매장 직원 목록 (시급·연락처·이메일 없음)
create or replace view public.staff_directory as
  select user_id, store_id, name, role, status
    from public.user_account
   where store_id = app.my_store_id();
revoke all on public.staff_directory from public, anon;
grant select on public.staff_directory to authenticated;

-- ops_snapshot: 시급·연락처·이메일은 점주와 본인에게만 내려 준다 (매니저·알바생에게는 비움)
create or replace function public.ops_snapshot(p_week date, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.user_account := public.ops_actor(); result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to-p_from>93 then raise exception '조회 기간은 1~94일이어야 합니다.'; end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id',a.user_id,'name',a.name,'role',a.role,'store_id',a.store_id),
    'store',(select to_jsonb(s) from public.store s where s.store_id=a.store_id),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',u.user_id,'name',u.name,'role',u.role,'wage',case when a.role='점주' or u.user_id=a.user_id then u.hourly_wage end,'maxHours',u.max_weekly_hours,'phone',case when a.role='점주' or u.user_id=a.user_id then u.phone end,'email',case when a.role='점주' or u.user_id=a.user_id then u.email end,'status',u.status,'availability_week',u.availability_week,'linked',u.auth_user_id is not null,'avail','{}'::jsonb) order by u.user_id) from public.user_account u where u.store_id=a.store_id and (a.role in ('점주','매니저') or u.user_id=a.user_id)),'[]'),
    'menus',coalesce((select jsonb_agg(jsonb_build_object('id',m.menu_id,'name',m.menu_name,'category',m.category,'price',m.price,'onSale',m.is_on_sale,'sold',0)) from public.menu m where m.store_id=a.store_id),'[]'),
    'ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',i.ingredient_id,'name',i.ingredient_name,'unit',i.use_unit,'orderLabel',i.order_unit,'orderUnit',i.conversion_rate,'price',i.unit_price,'min',i.min_stock,'supplier',i.supplier,'stock',coalesce(v.current_qty,0),'use',0,'factor',1)) from public.ingredient i left join public.inventory v using(ingredient_id) where i.store_id=a.store_id),'[]'),
    'recipes',coalesce((select jsonb_agg(jsonb_build_object('menu_id',r.menu_id,'ingredient_id',r.ingredient_id,'qty',r.qty_per_menu)) from public.recipe r join public.menu m using(menu_id) where m.store_id=a.store_id),'[]'),
    'availability',coalesce((select jsonb_agg(to_jsonb(v)) from public.availability v join public.user_account u using(user_id) where u.store_id=a.store_id and v.target_week=p_week and (a.role in ('점주','매니저') or u.user_id=a.user_id)),'[]'),
    'forecast',coalesce((select jsonb_agg(to_jsonb(f)) from public.sales_forecast f where f.store_id=a.store_id and f.target_week=p_week and a.role in ('점주','매니저')),'[]'),
    'sales',coalesce((select jsonb_agg(to_jsonb(s) order by s.sold_at desc,s.sale_id desc) from public.sale s join public.menu m using(menu_id) where m.store_id=a.store_id and a.role='점주' and (s.sold_at at time zone 'Asia/Seoul')::date between p_from and p_to),'[]'),
    'summary',coalesce((select jsonb_agg(to_jsonb(s) order by s.base_date,s.time_slot) from public.sales_summary s where s.store_id=a.store_id and a.role='점주' and s.base_date between p_from and p_to),'[]')
  ) into result;
  return result;
end $$;

-- get_schedule: 매니저에게도 시급을 내려 주지 않는다
create or replace function public.get_schedule(
  p_store_id bigint, p_target_week date,
  p_shifts jsonb default '[{"id": "am", "end": 12, "start": 8}, {"id": "mid", "end": 17, "start": 12}, {"id": "pm", "end": 22, "start": 17}]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if p_store_id is distinct from app.my_store_id() then
    raise exception '다른 매장의 스케줄은 볼 수 없습니다.' using errcode = '42501';
  end if;
  r := public.get_schedule_impl(p_store_id, p_target_week, p_shifts);
  if r is not null and not app.is_admin() then
    if r->>'status' is distinct from '확정' then return null; end if;
    r := jsonb_set(r, '{staff}', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', e->'user_id', 'name', e->'name', 'role', e->'role', 'status', e->'status'))
        from jsonb_array_elements(r->'staff') e), '[]'::jsonb));
  elsif r is not null and not app.is_owner() then
    r := jsonb_set(r, '{staff}', coalesce((
      select jsonb_agg(e - 'hourly_wage') from jsonb_array_elements(r->'staff') e), '[]'::jsonb));
  end if;
  return r;
end $$;
revoke all on function public.get_schedule(bigint, date, jsonb) from public, anon;
grant execute on function public.get_schedule(bigint, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 급여·출퇴근
-- ---------------------------------------------------------------------
drop policy if exists "owner write payroll" on public.payroll;
drop policy if exists "owner write attendance" on public.attendance;
drop policy if exists "read payroll" on public.payroll;
create policy "read payroll" on public.payroll
  for select to authenticated using (user_id = app.my_user_id() or (app.is_owner() and app.user_in_store(user_id)));

-- ---------------------------------------------------------------------
-- 6. 매니저: 조회 + 검토 완료(의견)만
-- ---------------------------------------------------------------------
drop policy if exists "manager update work_schedule" on public.work_schedule;
drop policy if exists "admin write shift_assignment" on public.shift_assignment;
create policy "owner write shift_assignment" on public.shift_assignment
  for all to authenticated
  using (app.is_owner() and app.schedule_in_store(schedule_id))
  with check (app.is_owner() and app.schedule_in_store(schedule_id) and app.user_in_store(user_id));

-- 검토 완료: 검토중 -> 초안. 점주 알림은 상태 전환 트리거가 보내고, 의견이 있으면 따로 한 건 더 남긴다.
create or replace function public.submit_schedule_review(p_schedule_id bigint, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.user_account%rowtype;
  s  public.work_schedule%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  select * into me from public.user_account where user_id = app.my_user_id();
  if me.user_id is null or me.role <> '매니저' then
    raise exception '매니저만 검토를 완료할 수 있습니다.' using errcode = '42501';
  end if;
  select * into s from public.work_schedule where schedule_id = p_schedule_id and store_id = me.store_id for update;
  if not found then raise exception '근무표를 찾을 수 없습니다.'; end if;
  if s.status <> '검토중' then raise exception '검토 요청된 근무표만 검토를 완료할 수 있습니다.'; end if;
  if length(v_comment) > 400 then raise exception '검토 의견은 400자 이하로 적어 주세요.'; end if;

  update public.work_schedule set status = '초안', is_published = false where schedule_id = p_schedule_id;

  if v_comment <> '' then
    insert into public.notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '근무 스케줄', '수동 신고',
           left(to_char(s.target_week, 'MM.DD') || ' 주 검토 의견(' || me.name || '): ' || v_comment, 500), now(), false
      from public.user_account u
     where u.store_id = me.store_id and u.role = '점주' and u.status = '활성';
  end if;
end $$;
revoke all on function public.submit_schedule_review(bigint, text) from public, anon;
grant execute on function public.submit_schedule_review(bigint, text) to authenticated;
