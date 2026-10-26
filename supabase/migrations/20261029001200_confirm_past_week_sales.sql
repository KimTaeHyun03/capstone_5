-- =====================================================================
-- 지난 주 판매 집계를 "확정"으로 바꾼다.
-- 매출 현황(1-2)과 매출 예측(1-3)은 확정된 집계(sales_summary.is_confirmed)만 읽는데, 어디에서도 확정으로 바꾸지 않았다.
-- 그래서 판매 CSV·직접 입력으로 시작한 실제 매장은 지난주 판매가 있어도 매출 현황이 비고 예측을 계산할 수 없었다(시드 데이터는 처음부터 확정).
-- 규칙: 한국 시간 기준으로 이번 주 월요일 이전 날짜의 집계는 끝난 주이므로 확정이다.
--   1) 집계 행을 저장할 때 지난 주 날짜이면 바로 확정(과거 기간 판매 CSV를 올린 경우)
--   2) 이미 쌓인 지난 주 집계는 이번 마이그레이션에서 확정
--   3) 이번 주에 쌓이다가 주가 끝난 집계는 주간 정산(run_weekly_jobs, 1-E2)이 월요일 새벽에 확정
-- =====================================================================

create or replace function app.confirm_past_week_summary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_date < date_trunc('week', now() at time zone 'Asia/Seoul')::date then
    new.is_confirmed := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_confirm_past_week_summary on public.sales_summary;
create trigger trg_confirm_past_week_summary
  before insert or update on public.sales_summary
  for each row execute function app.confirm_past_week_summary();

update public.sales_summary
   set is_confirmed = true
 where not is_confirmed
   and base_date < date_trunc('week', now() at time zone 'Asia/Seoul')::date;

-- 주간 정산 맨 앞에 "끝난 주 확정" 단계를 넣는다(예측이 확정된 집계를 쓰므로 반드시 예측보다 먼저).
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

-- CREATE OR REPLACE 는 함수에 붙은 SET 을 지우므로 다시 지정한다.
alter function run_weekly_jobs() set timezone to 'Asia/Seoul';
revoke all on function run_weekly_jobs() from public, anon, authenticated;
