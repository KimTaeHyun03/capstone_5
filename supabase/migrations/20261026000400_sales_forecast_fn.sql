-- =====================================================================
-- 2단계 · 1-3 매출 예측 생성 (이벤트 1-E2 의 계산 부분)
-- 예측 = 최근 N주(기본 4주) 같은 요일·시간대 평균 × (1 + 증감률)
--   증감률 = 최근 1주 합계 / 그 이전 주들의 주 평균 합계 − 1, ±20% 로 제한 (1주뿐이면 0)
-- 필요 인원 = 시간당 예측 매출 5만원 미만 1명 · 10만원 미만 2명 · 그 이상 3명 (화면 needStaff 와 같은 기준)
-- 피크타임 = 필요 인원이 최대(3명)인 시간대
-- 증원 검토 = 필요 인원이 최근 1주 실적 기준 인원보다 많은 시간대 (1-E3)
-- 지금은 점주가 화면에서 실행한다. 매주 자동 실행(스케줄러)은 15단계에서 붙인다.
-- =====================================================================

create or replace function app.required_staff(p_amount integer) returns integer
language sql immutable set search_path = '' as $$
  select case when p_amount < 50000 then 1 when p_amount < 100000 then 2 else 3 end
$$;

create or replace function public.generate_sales_forecast(p_target_week date default null, p_weeks integer default 4)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_store      bigint := app.my_store_id();
  v_target     date;
  v_weeks      date[];
  v_last_total numeric;
  v_prev_avg   numeric;
  v_growth     numeric := 0;
  v_count      integer;
begin
  if v_store is null or not app.is_owner() then
    raise exception '점주만 매출 예측을 실행할 수 있습니다' using errcode = '42501';
  end if;

  -- 대상 주 시작일(월요일). 비우면 다음 주
  v_target := date_trunc('week', coalesce(p_target_week, (now() at time zone 'Asia/Seoul')::date + 7))::date;

  -- 대상 주 이전, 확정 매출이 있는 최근 N주
  select array_agg(wk order by wk desc) into v_weeks
    from (select distinct date_trunc('week', base_date)::date as wk
            from public.sales_summary
           where store_id = v_store and is_confirmed and base_date < v_target
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
     where store_id = v_store and is_confirmed and date_trunc('week', base_date)::date = any (v_weeks);
    if v_prev_avg > 0 then
      v_growth := least(0.2, greatest(-0.2, v_last_total / v_prev_avg - 1));
    end if;
  end if;

  -- 같은 주 예측은 다시 계산한 값으로 교체
  delete from public.sales_forecast where store_id = v_store and target_week = v_target;

  with base as (
    select day_of_week, time_slot, avg(sales_amount) as avg_amount
      from public.sales_summary
     where store_id = v_store and is_confirmed and date_trunc('week', base_date)::date = any (v_weeks)
     group by day_of_week, time_slot
  ), last_week as (
    select day_of_week, time_slot, app.required_staff(sales_amount) as staff
      from public.sales_summary
     where store_id = v_store and is_confirmed and date_trunc('week', base_date)::date = v_weeks[1]
  ), calc as (
    select day_of_week, time_slot, (round(avg_amount * (1 + v_growth) / 1000) * 1000)::integer as amount
      from base
  )
  insert into public.sales_forecast (store_id, target_week, day_of_week, time_slot, forecast_amount, is_peak, required_staff, needs_more_staff)
  select v_store, v_target, c.day_of_week, c.time_slot, c.amount,
         app.required_staff(c.amount) = 3,
         app.required_staff(c.amount),
         app.required_staff(c.amount) > coalesce(l.staff, app.required_staff(c.amount))
    from calc c
    left join last_week l using (day_of_week, time_slot);

  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.generate_sales_forecast(date, integer) is '1-3 매출 예측 생성(점주). 최근 N주 평균 × 증감률';

revoke all on function app.required_staff(integer) from public, anon;
grant execute on function app.required_staff(integer) to authenticated;
revoke all on function public.generate_sales_forecast(date, integer) from public, anon;
grant execute on function public.generate_sales_forecast(date, integer) to authenticated;
