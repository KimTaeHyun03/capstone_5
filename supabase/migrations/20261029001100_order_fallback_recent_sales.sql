-- =====================================================================
-- 처음 쓰는 매장의 권장 발주량: 마감 기록이 없을 때의 예상 소진량을 "최근 판매 기록"으로 잡는다.
-- 이전에는 "다음 주 시작일 7일 전부터"의 판매 차감만 합산해서, 판매 기록이 그보다 이전 날짜이면(CSV로 지난 기간을 올린 새 매장 등)
-- 예상 소진량이 0이 되어 재고가 부족해도 권장 발주량이 0으로 나왔다.
-- 바뀐 계산: 그 매장의 가장 최근 판매일을 기준으로 최대 14일(판매 기록이 그보다 짧으면 그 일수)의 하루 평균 소진량 × 7.
-- 마감 기록(forecast_error)이 있으면 이전과 똑같이 마감 기록을 쓴다.
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
  v_first   date;   -- 그 매장의 첫·마지막 판매 차감일
  v_last    date;
  v_days    integer;
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
      -- 마감 기록이 없는 처음 사용: 매장의 가장 최근 판매일 기준 최대 14일의 하루 평균 × 7
      select min(c.changed_at::date), max(c.changed_at::date) into v_first, v_last
        from inventory_change c join ingredient i using (ingredient_id)
       where i.store_id = r.store_id and c.change_type = '판매 차감';
      if v_last is null then
        v_base := 0;
      else
        v_days := least(14, v_last - v_first + 1);
        select coalesce(sum(-change_qty), 0) / v_days * 7 into v_base from inventory_change
         where ingredient_id = r.ingredient_id and change_type = '판매 차감'
           and changed_at::date > v_last - v_days;
      end if;
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

revoke all on function public.calculate_order_recommendations_impl(date) from public, anon, authenticated;
