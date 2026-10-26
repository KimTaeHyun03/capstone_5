-- =====================================================================
-- 매장별 처리로 범위를 좁힌다 (여러 매장에서 쓸 수 있게).
-- 권장 발주량 산출·기간 마감·보정 계수 계산이 전체 매장의 재료를 순회했고, 예상 매출을 매장 구분 없이 합산했으며,
-- 알림도 전체 점주에게 갔다. 점주가 부르면 "자기 매장"만 처리하고, 스케줄러(시스템 호출)는 모든 매장을 매장별로 처리한다.
-- 매장이 하나뿐일 때의 결과는 이전과 같다.
-- =====================================================================

create or replace function public.calculate_order_recommendations_impl(p_period_start date default null)
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Seoul'
as $$
declare
  v_store   bigint := app.my_store_id(); -- null = 시스템 호출(스케줄러): 모든 매장을 매장별로 처리
  v_start   date := coalesce(p_period_start, (date_trunc('week', current_date) + interval '7 days')::date);
  v_end     date := v_start + 6;
  r         record;
  fe        forecast_error%rowtype;
  v_coef    correction_coefficient%rowtype;
  v_stock   numeric;
  v_base    numeric;
  v_ratio   numeric;
  v_fc      numeric;
  v_sales   numeric;
  v_use     numeric;
  v_factor  numeric;
  v_conv    numeric;
  v_raw     numeric;
  v_rec     numeric;
  v_n       integer := 0;
begin
  for r in select * from ingredient where v_store is null or store_id = v_store order by ingredient_id loop
    -- 예상 매출은 그 재료가 속한 매장의 예측만 합산한다
    select coalesce(sum(forecast_amount), 0) into v_fc
      from sales_forecast where target_week = v_start and store_id = r.store_id;
    select coalesce(current_qty, 0) into v_stock from inventory where ingredient_id = r.ingredient_id;
    v_stock := coalesce(v_stock, 0);

    -- 예상 소진량
    select * into fe from forecast_error
     where ingredient_id = r.ingredient_id and period_end < v_start
     order by period_end desc limit 1;
    if found then
      v_base := fe.actual_usage;
      select coalesce(sum(sales_amount), 0) into v_sales from sales_summary
       where store_id = r.store_id and base_date between fe.period_start and fe.period_end;
      v_ratio := case when v_fc > 0 and v_sales > 0 then least(1.2, greatest(0.8, v_fc / v_sales)) else 1 end;
    else
      select coalesce(sum(-change_qty), 0) into v_base from inventory_change
       where ingredient_id = r.ingredient_id and change_type = '판매 차감'
         and changed_at >= (v_start::timestamptz - interval '7 days');
      v_ratio := 1;
    end if;
    v_use := round(v_base * v_ratio, 2);

    -- 보정 계수: 대상 기간 시작일에 유효한 가장 최근 행
    select * into v_coef from correction_coefficient
     where ingredient_id = r.ingredient_id and effective_from <= v_start
     order by effective_from desc, applied_at desc limit 1;
    v_factor := coalesce(v_coef.coefficient, 1);

    v_conv := coalesce(nullif(r.conversion_rate, 0), 1);
    v_raw := v_use * v_factor - v_stock;
    v_rec := case when v_raw <= 0 then 0 else ceil(v_raw / v_conv) * v_conv end;

    insert into order_recommendation
      (ingredient_id, coefficient_id, period_start, period_end, forecast_usage, stock_at_calc,
       recommended_qty, estimated_cost, calculated_at)
    values (r.ingredient_id, v_coef.coefficient_id, v_start, v_end, v_use, v_stock,
            v_rec, round(v_rec * coalesce(r.unit_price, 0)), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.close_period(p_period_start date, p_period_end date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from   timestamptz := p_period_start::timestamp at time zone 'Asia/Seoul';
  v_to     timestamptz := (p_period_end + 1)::timestamp at time zone 'Asia/Seoul';
  r        record;
  v_cur    numeric;
  v_open   numeric;
  v_close  numeric;
  v_recv   numeric;
  v_waste  numeric;
  v_actual numeric;
  v_fc     numeric;
  v_n      integer := 0;
  v_err    numeric;
  v_sum    numeric := 0;
  v_store  bigint := app.my_store_id(); -- null = 시스템 호출(스케줄러): 모든 매장
  v_stores bigint[] := '{}';            -- 새로 마감 기록이 생긴 매장
begin
  if p_period_end < p_period_start then raise exception '기간의 종료일이 시작일보다 빠릅니다.'; end if;

  for r in select i.ingredient_id, i.store_id, i.ingredient_name from ingredient i where v_store is null or i.store_id = v_store order by i.ingredient_id loop
    continue when exists (select 1 from forecast_error
                           where ingredient_id = r.ingredient_id and period_start = p_period_start and period_end = p_period_end);

    select coalesce(current_qty, 0) into v_cur from inventory where ingredient_id = r.ingredient_id;
    v_cur := coalesce(v_cur, 0);
    select v_cur - coalesce(sum(change_qty), 0) into v_open
      from inventory_change where ingredient_id = r.ingredient_id and changed_at >= v_from;
    select v_cur - coalesce(sum(change_qty), 0) into v_close
      from inventory_change where ingredient_id = r.ingredient_id and changed_at >= v_to;
    select coalesce(sum(change_qty), 0) into v_recv
      from inventory_change where ingredient_id = r.ingredient_id and change_type = '입고'
       and changed_at >= v_from and changed_at < v_to;
    select coalesce(sum(-change_qty), 0) into v_waste
      from inventory_change where ingredient_id = r.ingredient_id and change_type = '폐기'
       and changed_at >= v_from and changed_at < v_to;

    v_actual := v_open + v_recv - v_close;

    select forecast_usage into v_fc from order_recommendation
     where ingredient_id = r.ingredient_id and period_start = p_period_start
     order by calculated_at desc, recommendation_id desc limit 1;
    v_fc := coalesce(v_fc, v_actual);

    insert into forecast_error
      (ingredient_id, period_start, period_end, opening_stock, closing_stock, actual_usage, forecast_usage,
       error_qty, error_rate, waste_qty)
    values (r.ingredient_id, p_period_start, p_period_end, v_open, v_close, v_actual, v_fc,
            v_fc - v_actual, case when v_fc > 0 then round((v_fc - v_actual) / v_fc * 100, 2) else 0 end, v_waste);
    v_n := v_n + 1;
    v_stores := v_stores || r.store_id;
  end loop;

  -- 6-E2 리포트 알림(점주): 새로 마감된 매장의 점주에게만, 그 매장 재료의 평균 오차율로
  if v_n > 0 then
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '오차 리포트', '자동 감지',
           format('%s–%s 예측 오차·폐기 리포트가 준비됐습니다. (평균 오차율 %s%%)',
                  to_char(p_period_start, 'FMMM.DD'), to_char(p_period_end, 'FMMM.DD'), round(s.err, 1)),
           now(), false
      from (select i.store_id, coalesce(avg(abs(e.error_rate)), 0) as err
              from forecast_error e join ingredient i using (ingredient_id)
             where e.period_start = p_period_start and e.period_end = p_period_end and i.store_id = any (v_stores)
             group by i.store_id) s
      join user_account u on u.store_id = s.store_id and u.role = '점주' and u.status = '활성';
  end if;
  return v_n;
end;
$$;

create or replace function public.calculate_correction_coefficients(p_period_end date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_err_id  bigint;
  v_act     numeric;
  v_fc      numeric;
  v_new     numeric;
  v_prev    numeric;
  v_n       integer := 0;
  v_store   bigint := app.my_store_id(); -- null = 시스템 호출(스케줄러): 모든 매장
  v_stores  bigint[] := '{}';            -- 새 보정 계수가 생긴 재료의 매장(재료마다 한 번씩)
begin
  for r in select ingredient_id, store_id from ingredient where v_store is null or store_id = v_store order by ingredient_id loop
    -- 마감 기간(p_period_end)의 오차 기록이 없으면 계산할 수 없다.
    select error_id into v_err_id from forecast_error
     where ingredient_id = r.ingredient_id and period_end = p_period_end
     order by error_id desc limit 1;
    continue when v_err_id is null;
    continue when exists (select 1 from correction_coefficient where error_id = v_err_id); -- 이미 반영됨

    select sum(actual_usage), sum(forecast_usage) into v_act, v_fc from (
      select actual_usage, forecast_usage from forecast_error
       where ingredient_id = r.ingredient_id and period_end <= p_period_end
       order by period_end desc limit 3) t;
    v_new := case when v_fc > 0 then least(1.2, greatest(0.8, round(v_act / v_fc, 3))) else 1 end;

    select coefficient into v_prev from correction_coefficient
     where ingredient_id = r.ingredient_id order by effective_from desc, applied_at desc limit 1;

    insert into correction_coefficient (ingredient_id, error_id, previous_value, coefficient, effective_from, applied_at)
    values (r.ingredient_id, v_err_id, coalesce(v_prev, 1), v_new, p_period_end + 1, now());
    v_n := v_n + 1;
    v_stores := v_stores || r.store_id;
  end loop;

  if v_n > 0 then
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '보정 계수', '자동 감지',
           format('보정 계수가 새로 반영됐습니다. (%s개 재료) 다음 권장 발주량부터 적용됩니다.', s.n),
           now(), false
      from (select st as store_id, count(*) as n from unnest(v_stores) st group by st) s
      join user_account u on u.store_id = s.store_id and u.role = '점주' and u.status = '활성';
  end if;
  return v_n;
end;
$$;

revoke all on function public.calculate_order_recommendations_impl(date) from public, anon, authenticated;
revoke all on function public.close_period(date, date) from public, anon, authenticated;
revoke all on function public.calculate_correction_coefficients(date) from public, anon, authenticated;
