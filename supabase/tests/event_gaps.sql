-- 이벤트 보완(1-E2·1-E3·2-E2·7-E4) 검증 — 끝에 rollback 하므로 데이터가 남지 않는다. 시스템 호출(JWT 없음)로 실행한다.
-- 기대 1) run_weekly_jobs 가 새 매장의 다음 주 예측을 만든다(1-E2), 증원 검토 시간대가 있으면 점주에게 알림 1건(1-E3)
-- 기대 2) 가능시간을 낸 사람이 없는 시간대가 있으면 점주·매니저에게 알림(2-E2). 두 번 실행해도 알림은 늘지 않는다
-- 기대 3) 레시피 없는 메뉴가 팔리면 점주에게 알림 1건(7-E4), 한 번 더 팔려도 늘지 않음. 레시피 있는 메뉴는 알림 없음
begin;

do $$
declare
  v_store  bigint;
  v_owner  bigint; v_mgr bigint; v_staff bigint;
  v_target date := date_trunc('week', (now() at time zone 'Asia/Seoul')::date + 7)::date;
  v_menu_no bigint; v_menu_ok bigint; v_ing bigint;
  v_res jsonb; v_n int;
begin
  insert into store (store_name) values ('이벤트 테스트 매장') returning store_id into v_store;
  insert into user_account (store_id, login_id, password_hash, name, role, status) values (v_store, 'evt-owner', 'x', '테스트점주', '점주', '활성') returning user_id into v_owner;
  insert into user_account (store_id, login_id, password_hash, name, role, status) values (v_store, 'evt-mgr', 'x', '테스트매니저', '매니저', '활성') returning user_id into v_mgr;
  insert into user_account (store_id, login_id, password_hash, name, role, status) values (v_store, 'evt-staff', 'x', '테스트알바', '알바생', '활성') returning user_id into v_staff;

  -- 지지난주 120,000 / 지난주 40,000 (월 9시) → 예측 64,000(필요 2명)이 지난주 기준(1명)보다 많음 = 증원 검토
  -- 화요일 10시는 두 주 모두 60,000 → 필요 2명 그대로
  insert into sales_summary (store_id, base_date, day_of_week, time_slot, sales_amount, order_count, is_confirmed) values
    (v_store, v_target - 14, 0, 9, 120000, 10, true), (v_store, v_target - 7, 0, 9, 40000, 5, true),
    (v_store, v_target - 13, 1, 10, 60000, 6, true),  (v_store, v_target - 6, 1, 10, 60000, 6, true);
  -- 알바생은 화요일 10~12시만 가능 → 월 9시는 가능한 사람이 없음
  insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week) values (v_staff, 1, '10:00', '12:00', now(), v_target);

  v_res := run_weekly_jobs();
  raise notice 'weekly = %', v_res;

  select count(*) into v_n from sales_forecast where store_id = v_store and target_week = v_target;
  assert v_n = 2, format('예측 행 2개여야 함: %s', v_n);
  assert (select needs_more_staff from sales_forecast where store_id = v_store and target_week = v_target and day_of_week = 0), '월 9시는 증원 검토여야 함';
  assert not (select needs_more_staff from sales_forecast where store_id = v_store and target_week = v_target and day_of_week = 1), '화 10시는 증원 검토가 아니어야 함';

  assert (select count(*) from notification where recipient_id = v_owner and type = '증원 검토') = 1, '점주 증원 검토 알림 1건';
  assert (select count(*) from notification where recipient_id = v_mgr and type = '증원 검토') = 0, '매니저는 증원 검토 알림 대상 아님';
  assert (select count(*) from notification where recipient_id = v_owner and type = '빈 시간대') = 1, '점주 빈 시간대 알림 1건';
  assert (select count(*) from notification where recipient_id = v_mgr and type = '빈 시간대') = 1, '매니저 빈 시간대 알림 1건';
  assert (select content from notification where recipient_id = v_owner and type = '빈 시간대') like '%월 9시%', '빈 시간대 예시에 월 9시 포함';
  assert (select content from notification where recipient_id = v_owner and type = '빈 시간대') like '% 1개 %', '빈 시간대는 1개(화 10시는 가능)';

  -- 재실행해도 알림이 늘지 않고, 예측은 같은 주를 교체한다
  perform run_weekly_jobs();
  assert (select count(*) from notification where recipient_id in (v_owner, v_mgr) and type in ('증원 검토', '빈 시간대')) = 3, '재실행해도 알림은 3건 유지';
  assert (select count(*) from sales_forecast where store_id = v_store and target_week = v_target) = 2, '예측 행은 교체되어 2개 유지';

  -- 7-E4
  insert into menu (store_id, menu_name, price, is_on_sale) values (v_store, '레시피없는메뉴', 4000, true) returning menu_id into v_menu_no;
  insert into menu (store_id, menu_name, price, is_on_sale) values (v_store, '레시피있는메뉴', 4000, true) returning menu_id into v_menu_ok;
  insert into ingredient (store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock)
  values (v_store, '테스트재료', 'g', 'kg', 1000, 20, 0) returning ingredient_id into v_ing;
  insert into inventory (ingredient_id, current_qty, updated_at, is_short) values (v_ing, 100, now(), false);
  insert into recipe (menu_id, ingredient_id, qty_per_menu) values (v_menu_ok, v_ing, 5);

  insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('EVT-1', v_menu_ok, now(), 1, 4000);
  assert (select count(*) from notification where recipient_id = v_owner and type = '레시피 미등록') = 0, '레시피 있는 메뉴는 알림 없음';
  assert (select current_qty from inventory where ingredient_id = v_ing) = 95, '레시피 있는 메뉴는 정상 차감';

  insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('EVT-2', v_menu_no, now(), 1, 4000);
  insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('EVT-3', v_menu_no, now(), 1, 4000);
  assert (select count(*) from notification where recipient_id = v_owner and type = '레시피 미등록') = 1, '같은 메뉴 알림은 읽기 전까지 1건';
  assert (select count(*) from notification where recipient_id = v_mgr and type = '레시피 미등록') = 0, '매니저는 대상 아님';

  update notification set is_read = true where recipient_id = v_owner and type = '레시피 미등록';
  insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('EVT-4', v_menu_no, now(), 1, 4000);
  assert (select count(*) from notification where recipient_id = v_owner and type = '레시피 미등록') = 2, '읽은 뒤 다시 팔리면 새 알림';

  raise notice 'event_gaps: PASS';
end $$;

rollback;
