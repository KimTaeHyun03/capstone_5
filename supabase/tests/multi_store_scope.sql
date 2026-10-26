-- 매장별 범위 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 기대 1) 새 매장 점주가 기간 마감·권장 발주량을 실행해도 다른 매장(기존 매장)의 재료·점주에게는 아무 영향이 없다
-- 기대 2) 새 매장 자신의 재료에는 정상적으로 기록·알림이 생긴다
-- 기대 3) 스케줄러(시스템 호출)는 모든 매장을 매장별로 처리한다
begin;

do $$
declare
  v_a bigint := (select min(store_id) from store);
  v_b bigint; v_owner_b bigint; v_ing_b bigint; v_auth uuid := gen_random_uuid();
  v_a_rows_before int; v_a_recs_before int; v_a_notif_before int;
  v_period date := date '2027-03-01';
begin
  insert into store (store_name) values ('범위 테스트 매장') returning store_id into v_b;
  insert into auth.users (id, email, email_confirmed_at) values (v_auth, 'scope-owner@example.invalid', now());
  insert into user_account (store_id, login_id, password_hash, name, role, status, auth_user_id) values (v_b, 'scope-owner', 'x', '점주B', '점주', '활성', v_auth) returning user_id into v_owner_b;
  insert into ingredient (store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock) values (v_b, '범위재료', 'g', 'kg', 1000, 20, 0) returning ingredient_id into v_ing_b;
  insert into inventory (ingredient_id, current_qty, updated_at, is_short) values (v_ing_b, 100, now(), false);

  select count(*) into v_a_rows_before from forecast_error e join ingredient i using (ingredient_id) where i.store_id = v_a;
  select count(*) into v_a_recs_before from order_recommendation r join ingredient i using (ingredient_id) where i.store_id = v_a;
  select count(*) into v_a_notif_before from notification n join user_account u on u.user_id = n.recipient_id where u.store_id = v_a;

  -- 새 매장 점주로 마감·권장량 실행
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  perform run_period_close(v_period);
  perform calculate_order_recommendations(v_period + 7);
  perform set_config('request.jwt.claims', '', true);

  assert (select count(*) from forecast_error e join ingredient i using (ingredient_id) where i.store_id = v_a) = v_a_rows_before, '다른 매장의 마감 기록이 생기면 안 됨';
  assert (select count(*) from order_recommendation r join ingredient i using (ingredient_id) where i.store_id = v_a) = v_a_recs_before, '다른 매장의 권장 발주량이 생기면 안 됨';
  assert (select count(*) from notification n join user_account u on u.user_id = n.recipient_id where u.store_id = v_a) = v_a_notif_before, '다른 매장 점주에게 알림이 가면 안 됨';
  assert (select count(*) from forecast_error where ingredient_id = v_ing_b and period_start = v_period) = 1, '새 매장 재료의 마감 기록 1건';
  assert (select count(*) from order_recommendation where ingredient_id = v_ing_b and period_start = v_period + 7) = 1, '새 매장 재료의 권장 발주량 1건';
  assert (select count(*) from notification where recipient_id = v_owner_b and type = '오차 리포트') = 1, '새 매장 점주 오차 리포트 알림 1건';
  assert (select count(*) from notification where recipient_id = v_owner_b and type = '보정 계수') = 1, '새 매장 점주 보정 계수 알림 1건';

  -- 시스템 호출(스케줄러)은 모든 매장을 처리한다: 같은 기간을 다시 마감해도 이미 마감된 재료는 건너뛰고, 아직 없는 다른 기간은 양쪽 매장 모두 처리
  perform run_period_close(v_period + 7);
  assert (select count(*) from forecast_error where ingredient_id = v_ing_b and period_start = v_period + 7) = 1, '시스템 호출: 새 매장도 처리';
  assert (select count(*) from forecast_error e join ingredient i using (ingredient_id) where i.store_id = v_a and e.period_start = v_period + 7) = (select count(*) from ingredient where store_id = v_a), '시스템 호출: 기존 매장도 처리';

  raise notice 'multi_store_scope: PASS';
end $$;

rollback;
