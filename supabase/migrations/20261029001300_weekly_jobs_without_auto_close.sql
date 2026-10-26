-- =====================================================================
-- 기간 마감(예측 오차·보정 계수)을 월요일 자동 정산에서 뺀다. 마감은 점주가 화면에서 직접 실행한다.
-- 이유: 지금은 POS 연동이 없어서 판매가 CSV 로 올라온다. 판매를 올리기 전에 자동 마감이 돌면 판매 0 으로 마감이 확정되고
--       (실제 소진 0 → 오차 100%, 보정 계수 0.80), 이미 마감된 기간은 다시 계산되지 않는다.
-- 주간 정산에 남는 것: 끝난 주 매출 집계 확정 → 급여 → 다음 주 예측 → 빈 시간대 감지 → 권장 발주량
-- 점주는 판매를 올린 뒤 예측 오차 보정 화면의 '지난주 마감 실행'(또는 권장 발주 화면의 '지난주 마감하고 다시 계산')으로 마감한다.
-- POS 연동으로 판매가 실시간으로 들어오게 되면, 급여 계산 다음에 run_period_close() 호출을 다시 넣으면 된다(20261029001200 의 함수와 같은 모양).
-- =====================================================================

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
  v_confirmed integer := 0;
begin
  begin
    update sales_summary set is_confirmed = true
     where not is_confirmed and base_date < date_trunc('week', now() at time zone 'Asia/Seoul')::date;
    get diagnostics v_confirmed = row_count;
    v_result := v_result || jsonb_build_object('summary_confirmed', v_confirmed);
  exception when others then
    v_result := v_result || jsonb_build_object('summary_confirm_error', sqlerrm);
    raise warning 'weekly-jobs 매출 집계 확정 실패: %', sqlerrm;
  end;
  begin
    v_result := v_result || jsonb_build_object('payroll_users', calculate_payroll());
  exception when others then
    v_result := v_result || jsonb_build_object('payroll_error', sqlerrm);
    raise warning 'weekly-jobs 급여 계산 실패: %', sqlerrm;
  end;
  -- 기간 마감(run_period_close)은 자동으로 하지 않는다. 점주가 판매를 올린 뒤 직접 실행한다.
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
    -- 마감된 가장 최근 기간의 보정 계수로 다음 주 권장 발주량을 계산한다.
    v_result := v_result || jsonb_build_object('recommendations', calculate_order_recommendations());
  exception when others then
    v_result := v_result || jsonb_build_object('recommendations_error', sqlerrm);
    raise warning 'weekly-jobs 권장 발주량 계산 실패: %', sqlerrm;
  end;
  return v_result;
end;
$$;

-- CREATE OR REPLACE 는 함수에 붙은 SET 을 지우므로 다시 지정한다.
alter function run_weekly_jobs() set timezone to 'Asia/Seoul';
revoke all on function run_weekly_jobs() from public, anon, authenticated;
