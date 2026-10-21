-- ⚠️ 개발용 임시 권한 — 인증(0단계)이 붙으면 제거하고 역할별(점주: 산출·발주, 매니저: 입고)로 교체한다.
-- 20261021000200_dev_policies_temp.sql 과 같은 방식: 직접 INSERT 는 열지 않고 함수 실행만 허용한다.
-- 읽기(order_recommendation·purchase_order·correction_coefficient)는 초기 마이그레이션의 anon 읽기 정책을 쓴다.
grant execute on function calculate_order_recommendations(date) to anon;
grant execute on function place_purchase_order(bigint, jsonb) to anon;
grant execute on function receive_purchase_order(bigint, jsonb) to anon;
