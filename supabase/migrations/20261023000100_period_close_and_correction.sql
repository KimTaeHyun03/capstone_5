-- 6-1 오차·폐기 리포트 (이벤트 6-E1 기간 마감 자동 집계, 6-E2 리포트 알림)
-- 6-2 보정 계수 반영 (이벤트 6-E3). 테이블은 추가하지 않는다(22개 유지).
--
-- 실제 소진량 = 기초 재고 + 입고 − 기말 재고. 시점별 재고는 현재 재고에서 이후의 변동 기록(inventory_change)을
--   거꾸로 빼서 구한다(재고를 바꾸는 모든 경로가 변동 기록을 남기므로 가능하다).
-- 오차량 = 예측 − 실제 (양수면 예측이 많았던 것, 시드 forecast_error 와 같은 부호), 오차율 = 오차량 ÷ 예측 × 100
-- 폐기량 = 기간 내 '폐기' 변동 합계
-- 예측 소진량 = 그 기간을 대상으로 계산했던 권장 발주량의 예상 소진량(order_recommendation.forecast_usage).
--   그 기간 권장량 기록이 없으면 실제와 같게 두어 오차 0(= 계수 변화 없음)으로 처리한다.
-- 보정 계수 = 최근 3개 기간 실제 소진 합 ÷ 예측 소진 합, 0.80 ~ 1.20 로 제한. 계산할 때마다 새 행(이력 유지).
--   적용 시작일 = 마감 기간 다음 날(다음 주 월요일). 다음 권장 발주량 계산이 이 값을 쓴다.
-- 기간은 한국 시간(Asia/Seoul) 기준 [시작일 00:00, 종료일 다음날 00:00)이다.

-- 6-E1 기간 마감 집계. 이미 마감된 (재료, 기간)은 건너뛴다. 새로 만든 건수 반환.
create or replace function close_period(p_period_start date, p_period_end date)
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
begin
  if p_period_end < p_period_start then raise exception '기간의 종료일이 시작일보다 빠릅니다.'; end if;

  for r in select i.ingredient_id, i.store_id, i.ingredient_name from ingredient i order by i.ingredient_id loop
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
  end loop;

  -- 6-E2 리포트 알림(점주)
  if v_n > 0 then
    select coalesce(avg(abs(error_rate)), 0) into v_err from forecast_error
     where period_start = p_period_start and period_end = p_period_end;
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '오차 리포트', '자동 감지',
           format('%s–%s 예측 오차·폐기 리포트가 준비됐습니다. (평균 오차율 %s%%)',
                  to_char(p_period_start, 'FMMM.DD'), to_char(p_period_end, 'FMMM.DD'), round(v_err, 1)),
           now(), false
      from user_account u where u.role = '점주' and u.status = '활성';
  end if;
  return v_n;
end;
$$;

-- 6-2 보정 계수 산출·저장(6-E3). p_period_end 기간까지 마감된 최근 3개 기간으로 계산한다. 새로 만든 건수 반환.
create or replace function calculate_correction_coefficients(p_period_end date)
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
begin
  for r in select ingredient_id from ingredient order by ingredient_id loop
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
  end loop;

  if v_n > 0 then
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
    select u.user_id, null, '보정 계수', '자동 감지',
           format('보정 계수가 새로 반영됐습니다. (%s개 재료) 다음 권장 발주량부터 적용됩니다.', v_n),
           now(), false
      from user_account u where u.role = '점주' and u.status = '활성';
  end if;
  return v_n;
end;
$$;

-- 마감 → 보정 한 번에. 기간을 주지 않으면 지난주(월~일). 스케줄러(15단계)가 이 함수를 부른다.
create or replace function run_period_close(p_period_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start  date := coalesce(p_period_start, (date_trunc('week', current_date) - interval '7 days')::date);
  v_end    date := v_start + 6;
  v_closed integer;
  v_coef   integer;
begin
  v_closed := close_period(v_start, v_end);
  v_coef := calculate_correction_coefficients(v_end);
  return jsonb_build_object('period_start', v_start, 'period_end', v_end, 'closed', v_closed, 'coefficients', v_coef);
end;
$$;

revoke all on function close_period(date, date) from public, anon, authenticated;
revoke all on function calculate_correction_coefficients(date) from public, anon, authenticated;
revoke all on function run_period_close(date) from public, anon, authenticated;
