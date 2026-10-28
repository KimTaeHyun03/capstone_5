-- =====================================================================
-- 주변 행사 기능 되돌리기 — 20261030000100_local_events.sql 적용 후 문제가 생겼을 때만 SQL Editor 에서 실행
-- 하는 일: 감싸는 함수를 지우고 원래 함수 이름을 되돌린다 → 행사 함수·테이블·컬럼 삭제.
-- 삭제되는 데이터: 입력·수집한 행사(local_event)와 예측 행의 행사 가산 기록(event_uplift, base_amount).
-- 남는 것: 이미 만들어진 예측·권장 발주량 행의 숫자(행사 가산이 곱해진 채로 남는다) → 아래 마지막에 예측만 가산 전 금액으로 복원한다.
-- 다시 적용하려면 이 파일을 실행한 뒤 마이그레이션을 처음부터 다시 실행한다.
-- =====================================================================
begin;

-- 1) 행사 가산이 곱해진 예측을 가산 전 금액으로 되돌린다(컬럼을 지우기 전에).
update sales_forecast
   set forecast_amount = base_amount,
       required_staff = app.required_staff(base_amount),
       is_peak = app.required_staff(base_amount) = 3
 where base_amount is not null;

-- 2) 함수: 감싸는 함수를 지우고 원래 함수를 제자리로
drop function if exists app.generate_sales_forecast_for(bigint, date, integer);
alter function app.generate_sales_forecast_for_pre_events(bigint, date, integer) rename to generate_sales_forecast_for;

drop function if exists public.calculate_order_recommendations_impl(date);
alter function public.calculate_order_recommendations_impl_pre_events(date) rename to calculate_order_recommendations_impl;

drop function if exists public.upsert_synced_events(bigint, jsonb);
drop function if exists public.refresh_forecast_with_events(date);
drop function if exists public.delete_local_event(bigint);
drop function if exists public.set_local_event_status(bigint, text);
drop function if exists public.save_local_event(jsonb);
drop function if exists public.set_store_location(numeric, numeric, integer);
drop function if exists app.update_event_actuals(bigint);
drop function if exists app.event_uplift_slots(bigint, date);
drop function if exists app.default_uplift(bigint, text, integer, integer);
drop function if exists app.event_order_qty(numeric, numeric, numeric, numeric);
drop function if exists app.haversine_m(numeric, numeric, numeric, numeric);

-- 3) 테이블·컬럼
drop table if exists local_event;
alter table sales_forecast drop column if exists event_uplift, drop column if exists base_amount;
alter table store drop column if exists latitude, drop column if exists longitude, drop column if exists event_radius_m;

-- 4) 행사 알림 정리
delete from notification where type in ('주변 행사 반영', '주변 행사 제안');

commit;

-- 권장 발주량은 행사 가산이 곱해진 상태로 남아 있다. 앱의 '권장 발주량 다시 계산'(또는 calculate_order_recommendations)을 한 번 실행하면 원래대로 다시 계산된다.
-- 마이그레이션 기록을 지우려면(다시 적용할 때): delete from supabase_migrations.schema_migrations where version = '20261030000100';
