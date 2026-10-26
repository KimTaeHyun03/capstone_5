-- =====================================================================
-- 미구현 이벤트 보완: 1-E2 주간 매출 예측 자동 실행, 1-E3 증원 검토 알림, 2-E2 빈 시간대 알림, 7-E4 레시피 미등록 알림
-- 테이블은 추가하지 않는다(22개 유지). 알림은 공통 notification 테이블에 기록한다.
--
-- ■ 1-E2: 예측 계산 본문을 app.generate_sales_forecast_for(매장) 로 옮기고, 화면용 public.generate_sales_forecast 는
--   "점주 확인 + 내 매장" 래퍼로 남긴다(호출 방식·인자·반환값 동일). 주간 정산(run_weekly_jobs)은 매장마다 이 함수를 부른다.
-- ■ 1-E3: 예측 결과에 증원 검토 시간대(needs_more_staff)가 있으면 점주에게 알림. 같은 주 알림은 한 번만.
-- ■ 2-E2: 예측상 인원이 필요한데 가능시간을 낸 사람이 0명인 시간대가 있으면 점주·매니저에게 알림. 같은 주 알림은 한 번만.
-- ■ 7-E4: 레시피 없는 메뉴가 팔리면(자동 차감 제외) 점주에게 알림. 읽기 전에는 같은 메뉴를 다시 보내지 않는다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 예측 계산(매장 지정) — 내부 전용. 본문은 20261026000400 과 같고, 끝에 1-E3 알림이 붙는다.
-- ---------------------------------------------------------------------
create or replace function app.generate_sales_forecast_for(p_store bigint, p_target_week date default null, p_weeks integer default 4)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_target     date;
  v_weeks      date[];
  v_last_total numeric;
  v_prev_avg   numeric;
  v_growth     numeric := 0;
  v_count      integer;
  v_more       integer;
  v_peak       integer;
  v_label      text;
begin
  v_target := date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date;

  select array_agg(wk order by wk desc) into v_weeks
    from (select distinct date_trunc('week', base_date)::date as wk
            from public.sales_summary
           where store_id = p_store and is_confirmed and base_date < v_target
           order by wk desc
           limit greatest(p_weeks, 1)) w;

  if v_weeks is null then
    raise exception '예측에 쓸 확정 매출 집계가 없습니다' using errcode = 'P0002';
  end if;

  if array_length(v_weeks, 1) > 1 then
    select sum(sales_amount) filter (where date_trunc('week', base_date)::date = v_weeks[1]),
           sum(sales_amount) filter (where date_trunc('week', base_date)::date <> v_weeks[1]) / (array_length(v_weeks, 1) - 1)
      into v_last_total, v_prev_avg
      from public.sales_summary
     where store_id = p_store and is_confirmed and date_trunc('week', base_date)::date = any (v_weeks);
    if v_prev_avg > 0 then
      v_growth := least(0.2, greatest(-0.2, v_last_total / v_prev_avg - 1));
    end if;
  end if;

  delete from public.sales_forecast where store_id = p_store and target_week = v_target;

  with base as (
    select day_of_week, time_slot, avg(sales_amount) as avg_amount
      from public.sales_summary
     where store_id = p_store and is_confirmed and date_trunc('week', base_date)::date = any (v_weeks)
     group by day_of_week, time_slot
  ), last_week as (
    select day_of_week, time_slot, app.required_staff(sales_amount) as staff
      from public.sales_summary
     where store_id = p_store and is_confirmed and date_trunc('week', base_date)::date = v_weeks[1]
  ), calc as (
    select day_of_week, time_slot, (round(avg_amount * (1 + v_growth) / 1000) * 1000)::integer as amount
      from base
  )
  insert into public.sales_forecast (store_id, target_week, day_of_week, time_slot, forecast_amount, is_peak, required_staff, needs_more_staff)
  select p_store, v_target, c.day_of_week, c.time_slot, c.amount,
         app.required_staff(c.amount) = 3,
         app.required_staff(c.amount),
         app.required_staff(c.amount) > coalesce(l.staff, app.required_staff(c.amount))
    from calc c
    left join last_week l using (day_of_week, time_slot);

  get diagnostics v_count = row_count;

  -- 1-E3 증원 검토 알림
  select count(*) filter (where needs_more_staff), count(*) filter (where is_peak)
    into v_more, v_peak
    from public.sales_forecast where store_id = p_store and target_week = v_target;
  if v_more > 0 then
    v_label := to_char(v_target, 'FMMM.DD');
    insert into public.notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '증원 검토', '자동 감지',
           format('%s 주 예측에서 지난주보다 인원이 더 필요한 시간대가 %s개 있습니다. (피크 시간대 %s개) 근무표를 만들 때 확인하세요.', v_label, v_more, v_peak),
           now(), false
      from public.user_account u
     where u.store_id = p_store and u.role = '점주' and u.status = '활성'
       and not exists (select 1 from public.notification n
                        where n.recipient_id = u.user_id and n.type = '증원 검토' and n.content like v_label || ' 주 %');
  end if;

  return v_count;
end $$;

-- 화면용 래퍼: 인자·반환값·권한은 이전과 같다.
create or replace function public.generate_sales_forecast(p_target_week date default null, p_weeks integer default 4)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_store bigint := app.my_store_id();
begin
  if v_store is null or not app.is_owner() then
    raise exception '점주만 매출 예측을 실행할 수 있습니다' using errcode = '42501';
  end if;
  return app.generate_sales_forecast_for(v_store, p_target_week, p_weeks);
end $$;

comment on function public.generate_sales_forecast(date, integer) is '1-3 매출 예측 생성(점주). 최근 N주 평균 × 증감률. 증원 검토 시간대가 있으면 점주에게 알림(1-E3)';

revoke all on function app.generate_sales_forecast_for(bigint, date, integer) from public, anon, authenticated;
revoke all on function public.generate_sales_forecast(date, integer) from public, anon;
grant execute on function public.generate_sales_forecast(date, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 2. 2-E2 빈 시간대 감지 알림 — 예측상 필요 인원이 있는데 그 시간에 가능한 사람이 0명인 시간대
--    가능시간은 대상 주 등록분을 쓰고, 그 주에 등록한 적이 없는 사람은 주차 없이 등록한 가능시간(이전 방식)을 쓴다.
--    "불가" 표시(is_unavailable)를 낸 사람은 그 주에 가능하지 않은 것으로 본다.
-- ---------------------------------------------------------------------
create or replace function app.notify_uncovered_slots(p_store bigint, p_target_week date default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_target date := date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date;
  v_label  text := to_char(date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date, 'FMMM.DD');
  v_days   text[] := array['월','화','수','목','금','토','일'];
  v_n      integer;
  v_sample text;
begin
  with staff as (
    select u.user_id from public.user_account u
     where u.store_id = p_store and u.role in ('매니저', '알바생') and u.status = '활성'
  ), eff as (
    select a.user_id, a.day_of_week, a.start_time, a.end_time
      from public.availability a join staff s using (user_id)
     where not a.is_unavailable
       and (a.target_week = v_target
            or (a.target_week is null and not exists (select 1 from public.availability w where w.user_id = a.user_id and w.target_week = v_target)))
  ), gap as (
    select f.day_of_week, f.time_slot
      from public.sales_forecast f
     where f.store_id = p_store and f.target_week = v_target and coalesce(f.required_staff, 0) > 0
       and not exists (select 1 from eff e
                        where e.day_of_week = f.day_of_week
                          and e.start_time <= make_time(f.time_slot::int, 0, 0) and e.end_time > make_time(f.time_slot::int, 0, 0))
  )
  select count(*), array_to_string((array_agg(v_days[day_of_week + 1] || ' ' || time_slot || '시' order by day_of_week, time_slot))[1:3], ', ')
    into v_n, v_sample from gap;

  if v_n = 0 then return 0; end if;

  insert into public.notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, null, '빈 시간대', '자동 감지',
         format('%s 주 가능시간을 낸 사람이 없는 시간대가 %s개 있습니다. (예: %s) 가능시간 현황을 확인하세요.', v_label, v_n, v_sample),
         now(), false
    from public.user_account u
   where u.store_id = p_store and u.role in ('점주', '매니저') and u.status = '활성'
     and not exists (select 1 from public.notification n
                      where n.recipient_id = u.user_id and n.type = '빈 시간대' and n.content like v_label || ' 주 %');
  return v_n;
end $$;

revoke all on function app.notify_uncovered_slots(bigint, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 1-E2 주간 정산에 예측 실행 + 빈 시간대 감지를 붙인다. 매장마다 따로 실행하고, 실패해도 나머지는 계속한다.
--    순서: 급여 → 마감·보정 계수 → 다음 주 예측 → 빈 시간대 감지 → 권장 발주량(예측이 있어야 매출 비율이 반영됨)
-- ---------------------------------------------------------------------
create or replace function run_weekly_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result  jsonb := '{}'::jsonb;
  v_store   record;
  v_slots   integer := 0;
  v_gaps    integer := 0;
  v_errors  jsonb := '[]'::jsonb;
begin
  begin
    v_result := v_result || jsonb_build_object('payroll_users', calculate_payroll());
  exception when others then
    v_result := v_result || jsonb_build_object('payroll_error', sqlerrm);
    raise warning 'weekly-jobs 급여 계산 실패: %', sqlerrm;
  end;
  begin
    v_result := v_result || jsonb_build_object('period_close', run_period_close());
  exception when others then
    v_result := v_result || jsonb_build_object('period_close_error', sqlerrm);
    raise warning 'weekly-jobs 기간 마감 실패: %', sqlerrm;
  end;
  for v_store in select store_id from store order by store_id loop
    begin
      v_slots := v_slots + app.generate_sales_forecast_for(v_store.store_id);
    exception when others then
      v_errors := v_errors || jsonb_build_object('store_id', v_store.store_id, 'step', 'forecast', 'error', sqlerrm);
      raise warning 'weekly-jobs 매출 예측 실패(매장 %): %', v_store.store_id, sqlerrm;
      continue; -- 예측이 없으면 빈 시간대 감지도 의미 없음
    end;
    begin
      v_gaps := v_gaps + app.notify_uncovered_slots(v_store.store_id);
    exception when others then
      v_errors := v_errors || jsonb_build_object('store_id', v_store.store_id, 'step', 'uncovered', 'error', sqlerrm);
      raise warning 'weekly-jobs 빈 시간대 감지 실패(매장 %): %', v_store.store_id, sqlerrm;
    end;
  end loop;
  v_result := v_result || jsonb_build_object('forecast_slots', v_slots, 'uncovered_slots', v_gaps);
  if jsonb_array_length(v_errors) > 0 then
    v_result := v_result || jsonb_build_object('forecast_errors', v_errors);
  end if;
  begin
    -- 보정 계수와 예측이 반영된 뒤 다음 주 권장 발주량을 계산한다(순서 중요).
    v_result := v_result || jsonb_build_object('recommendations', calculate_order_recommendations());
  exception when others then
    v_result := v_result || jsonb_build_object('recommendations_error', sqlerrm);
    raise warning 'weekly-jobs 권장 발주량 계산 실패: %', sqlerrm;
  end;
  return v_result;
end;
$$;

revoke all on function run_weekly_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. 7-E4 레시피 미등록 메뉴 알림 — 판매 차감 트리거에 붙인다(차감 동작은 이전과 같다).
-- ---------------------------------------------------------------------
create or replace function deduct_stock_on_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_qty  numeric;
  v_has  boolean := false;
  v_menu record;
  v_text text;
begin
  for r in select ingredient_id, qty_per_menu from recipe where menu_id = new.menu_id loop
    v_has := true;
    v_qty := r.qty_per_menu * new.quantity;
    insert into inventory_change (ingredient_id, change_type, sale_id, change_qty, changed_at)
    values (r.ingredient_id, '판매 차감', new.sale_id, -v_qty, new.sold_at);
    perform apply_stock_delta(r.ingredient_id, -v_qty);
  end loop;

  if not v_has then
    select menu_name, store_id into v_menu from menu where menu_id = new.menu_id;
    if found then
      v_text := format('"%s" 메뉴에 레시피가 없어 판매해도 재고가 자동 차감되지 않습니다. 메뉴·레시피에서 등록하세요.', v_menu.menu_name);
      insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
      select u.user_id, null, '레시피 미등록', '자동 감지', v_text, now(), false
        from user_account u
       where u.store_id = v_menu.store_id and u.role = '점주' and u.status = '활성'
         and not exists (select 1 from notification n
                          where n.recipient_id = u.user_id and n.type = '레시피 미등록' and n.content = v_text and not n.is_read);
    end if;
  end if;
  return new;
end;
$$;
