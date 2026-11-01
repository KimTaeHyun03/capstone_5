-- 지난주·이번주 예측 채우기: 이 매장은 예측을 만들기 시작하기 전의 주라 sales_forecast 가 비어 있다.
-- 예측 계산은 "대상 주 이전의 확정 매출"만 쓰므로(base_date < 대상 주), 과거 주를 만들어도 그 주 실적이 섞이지 않는다.
-- 이미 예측이 있는 주와, 그 이전 확정 매출이 없는 주는 건너뛴다. 알림(증원 검토·주변 행사 반영)은 보내지 않는다.
do $$
declare
  s record;
  w date;
  v_this date := (date_trunc('week', now() at time zone 'Asia/Seoul'))::date;
begin
  for s in select store_id from public.store loop
    foreach w in array array[v_this - 7, v_this] loop
      continue when exists (select 1 from public.sales_forecast f where f.store_id = s.store_id and f.target_week = w);
      continue when not exists (select 1 from public.sales_summary m where m.store_id = s.store_id and m.is_confirmed and m.base_date < w);
      perform app.generate_sales_forecast_for(s.store_id, w);
    end loop;
  end loop;
  -- 과거 주를 채우며 생긴 알림은 지운다 (이번 실행의 now() 와 같은 시각에 만들어진 것만)
  delete from public.notification where sent_at = now() and type in ('증원 검토', '주변 행사 반영');
end $$;
