-- =====================================================================
-- 시연용 예시 데이터 (10.12 ~ 10.25 두 주치 판매·재고·발주 + 11.02 주 가능시간). 모두 가짜 데이터다.
-- 마이그레이션이 아니라 "한 번 실행하는 데이터 스크립트"다. 20261029000200 마이그레이션을 적용한 뒤 실행한다.
--   원격 적용: npx supabase db query --linked -f seed_demo_data.sql
-- 한 트랜잭션이라 중간에 실패하면 아무것도 반영되지 않는다. 이미 실행했으면(DEMO- 결제번호가 있으면) 중단한다.
--
-- 하는 일
--  1. 기간 마감 스케줄러가 잘못 만든 기록(10.12–10.18, 판매가 없어 소진량 ≈ 0)을 지운다
--  2. 10.12–10.25 판매 기록(sale)을 만들고, 그 판매로 매출 집계(sales_summary)와 재고 차감 기록을 만든다
--     (시드의 10.05 주 매출 패턴을 요일·시간대별로 따르고, 두 번째 주는 약 6% 늘린다)
--  3. 주간 입고(재료별로 사용량을 넘지 않는 발주 단위), 폐기 기록, 지난 기간의 권장 발주량(=그때의 예측)을 넣는다
--  4. 10.12·10.19 기간을 마감해 예측 오차·보정 계수를 만든다 → 10.26·11.02 주 예측 → 11.02 주 권장 발주량
--  5. 11.02 주 가능시간(일부 시간대는 일부러 비워 둠)을 넣고 빈 시간대 알림을 만든다
-- 판매 직접 입력·CSV 업로드 화면 시연용 파일은 seed_sales_upload_sample.csv (10.26 오전~오후, DEMO 데이터와 겹치지 않음)
-- =====================================================================

begin;
set local time zone 'Asia/Seoul';
set local search_path = public;

do $guard$
begin
  if exists (select 1 from sale where payment_no like 'DEMO-%') then
    raise exception '이미 적용된 예시 데이터입니다 (DEMO- 결제번호가 있음).';
  end if;
end $guard$;

-- 재고 차감·입고 반영은 아래에서 변동 기록을 직접 만들어 넣으므로 자동 트리거는 잠시 끈다(끝에서 다시 켠다).
alter table sale disable trigger trg_sale_deduct_stock;
alter table receipt disable trigger trg_receipt_apply;

-- 1. 잘못 만들어진 기록 정리 -------------------------------------------------
delete from order_recommendation r
 where r.period_start >= date '2026-10-26'
   and not exists (select 1 from purchase_order p where p.recommendation_id = r.recommendation_id);
delete from correction_coefficient where error_id in (select error_id from forecast_error where period_start = date '2026-10-12');
delete from forecast_error where period_start = date '2026-10-12';
delete from notification where type in ('오차 리포트', '보정 계수') and sent_at >= timestamptz '2026-10-26 00:00+09';
delete from sales_forecast where target_week >= date '2026-10-26';

-- 2. 판매 기록 ---------------------------------------------------------------
create temp table _share (menu_name text primary key, share numeric) on commit drop;
insert into _share values ('아메리카노', .29), ('카페라떼', .26), ('바닐라 라떼', .11), ('초코 라떼', .09), ('레몬에이드', .11), ('크루아상', .14);

insert into sale (payment_no, menu_id, sold_at, quantity, amount)
select 'DEMO-' || to_char(d.day, 'MMDD') || '-' || lpad(b.time_slot::text, 2, '0') || '-' || m.menu_id,
       m.menu_id,
       (d.day::timestamp + make_interval(hours => b.time_slot, mins => 3 + m.menu_id::int * 7)) at time zone 'Asia/Seoul',
       q.qty, q.qty * m.price
  from (select date '2026-10-12' + n as day from generate_series(0, 13) n) d
  join sales_summary b on b.base_date between date '2026-10-05' and date '2026-10-11'
                      and b.day_of_week = extract(isodow from d.day)::int - 1
  join menu m on m.store_id = b.store_id
  join _share s on s.menu_name = m.menu_name
  cross join lateral (
    select round(b.sales_amount
                 * case when d.day >= date '2026-10-19' then 1.06 else 1.00 end
                 * (1 + ((abs(hashtext(d.day::text || ':' || b.time_slot)) % 13) - 6) / 100.0)
                 * s.share / m.price)::int as qty
  ) q
 where q.qty > 0;

insert into sales_summary (store_id, base_date, day_of_week, time_slot, sales_amount, order_count, is_confirmed)
select m.store_id,
       (s.sold_at at time zone 'Asia/Seoul')::date,
       extract(isodow from (s.sold_at at time zone 'Asia/Seoul'))::int - 1,
       extract(hour from (s.sold_at at time zone 'Asia/Seoul'))::int,
       sum(s.amount), greatest(1, round(sum(s.quantity) / 1.5))::int, true
  from sale s join menu m using (menu_id)
 where s.payment_no like 'DEMO-%'
 group by 1, 2, 3, 4;

insert into inventory_change (ingredient_id, change_type, sale_id, change_qty, reason, handled_by, changed_at)
select r.ingredient_id, '판매 차감', s.sale_id, -(r.qty_per_menu * s.quantity), null, null, s.sold_at
  from sale s join recipe r using (menu_id)
 where s.payment_no like 'DEMO-%';

-- 3. 폐기·입고·지난 기간 권장량 -------------------------------------------------
insert into inventory_change (ingredient_id, change_type, change_qty, reason, handled_by, changed_at)
select i.ingredient_id, '폐기', -w.qty, w.reason, (select user_id from user_account where role = '매니저' order by user_id limit 1), w.at::timestamptz
  from (values
    ('우유', 1, '2026-10-18 22:10+09', '유통기한 경과'), ('우유', 2, '2026-10-25 22:10+09', '유통기한 경과'),
    ('크루아상 생지', 3, '2026-10-18 22:20+09', '당일 잔량 폐기'), ('크루아상 생지', 4, '2026-10-25 22:20+09', '당일 잔량 폐기'),
    ('생크림', 0.5, '2026-10-18 22:15+09', '개봉 후 변질'), ('생크림', 0.3, '2026-10-25 22:15+09', '개봉 후 변질'),
    ('레몬', 3, '2026-10-18 22:25+09', '신선도 저하'), ('레몬', 2, '2026-10-25 22:25+09', '신선도 저하')
  ) as w(name, qty, at, reason)
  join ingredient i on i.ingredient_name = w.name;

create temp table _used on commit drop as
select ingredient_id,
       case when changed_at < timestamptz '2026-10-19 00:00+09' then date '2026-10-12' else date '2026-10-19' end as wk,
       sum(-change_qty) as used
  from inventory_change
 where change_type in ('판매 차감', '폐기') and changed_at >= timestamptz '2026-10-12 00:00+09'
 group by 1, 2;

do $receipts$
declare
  r       record;
  v_owner bigint := (select user_id from user_account where role = '점주' order by user_id limit 1);
  v_mgr   bigint := (select user_id from user_account where role = '매니저' order by user_id limit 1);
  v_po    bigint;
  v_rc    bigint;
begin
  -- 입고량은 그 주 사용량을 발주 단위로 "내림"한 값 → 재고가 음수가 되지 않고, 현재 재고(부족 알림 상태)는 그대로 유지된다.
  for r in
    select u.ingredient_id, u.wk, floor(u.used / greatest(i.conversion_rate, 1)) * greatest(i.conversion_rate, 1) as qty
      from _used u join ingredient i using (ingredient_id)
     order by u.wk, u.ingredient_id
  loop
    continue when r.qty <= 0;
    insert into purchase_order (ingredient_id, recommendation_id, ordered_by, order_qty, is_adjusted, status, ordered_at)
    values (r.ingredient_id, null, v_owner, r.qty, false, '입고완료', (r.wk - 2)::timestamp + time '18:00')
    returning order_id into v_po;
    insert into receipt (order_id, handled_by, received_qty, diff_qty, diff_reason, received_at)
    values (v_po, v_mgr, r.qty, 0, null, r.wk::timestamp + time '07:30')
    returning receipt_id into v_rc;
    insert into inventory_change (ingredient_id, change_type, receipt_id, change_qty, handled_by, changed_at)
    values (r.ingredient_id, '입고', v_rc, r.qty, v_mgr, r.wk::timestamp + time '07:30');
  end loop;
end $receipts$;

alter table sale enable trigger trg_sale_deduct_stock;
alter table receipt enable trigger trg_receipt_apply;

-- 그때의 예측(권장 발주량 계산 시점의 예상 소진량): 실제 소진량에 재료별 편차를 준다 → 예측 오차·보정 계수가 의미 있는 값이 된다
create temp table _dev (ingredient_name text primary key, dev_a numeric, dev_b numeric) on commit drop;
insert into _dev values ('원두', 1.04, .98), ('우유', .96, 1.03), ('바닐라 시럽', 1.00, 1.05), ('생크림', 1.10, 1.04),
                        ('크루아상 생지', 1.12, 1.08), ('컵 12oz', 1.02, 1.01), ('초코 소스', .95, .93), ('레몬', 1.15, 1.10);

insert into order_recommendation (ingredient_id, coefficient_id, period_start, period_end, forecast_usage, stock_at_calc, recommended_qty, estimated_cost, calculated_at)
select u.ingredient_id, null, u.wk, u.wk + 6, round(u.used * d.dev_a, 2),
       coalesce((select current_qty from inventory where ingredient_id = u.ingredient_id), 0), 0, 0,
       timestamptz '2026-10-11 20:00+09'
  from _used u join ingredient i using (ingredient_id) join _dev d on d.ingredient_name = i.ingredient_name
 where u.wk = date '2026-10-12';

update order_recommendation r
   set forecast_usage = round(u.used * d.dev_b, 2)
  from _used u, ingredient i, _dev d
 where r.period_start = date '2026-10-19' and u.wk = date '2026-10-19' and u.ingredient_id = r.ingredient_id
   and i.ingredient_id = r.ingredient_id and d.ingredient_name = i.ingredient_name;

-- 4. 기간 마감 → 예측 → 권장 발주량 ---------------------------------------------
select public.run_period_close(date '2026-10-12');
select public.run_period_close(date '2026-10-19');
select app.generate_sales_forecast_for((select min(store_id) from store), date '2026-10-26');
select app.generate_sales_forecast_for((select min(store_id) from store), date '2026-11-02');
select public.calculate_order_recommendations(date '2026-11-02');

-- 5. 11.02 주 가능시간 (금 20~22시, 목 16시는 아무도 못 해서 빈 시간대 알림 시연) -----------------
delete from availability where target_week = date '2026-11-02';
insert into availability (user_id, day_of_week, start_time, end_time, registered_at, target_week)
select u.user_id, a.dow, a.s::time, a.e::time, timestamptz '2026-10-24 10:00+09', date '2026-11-02'
  from (values
    ('jang@example.com', 0, '08:00', '16:00'), ('jang@example.com', 1, '08:00', '16:00'), ('jang@example.com', 2, '08:00', '16:00'),
    ('jang@example.com', 3, '08:00', '16:00'), ('jang@example.com', 4, '08:00', '16:00'),
    ('jung@example.com', 1, '17:00', '22:00'), ('jung@example.com', 3, '17:00', '22:00'),
    ('jung@example.com', 5, '12:00', '22:00'), ('jung@example.com', 6, '12:00', '22:00'),
    ('park@example.com', 0, '12:00', '20:00'), ('park@example.com', 2, '12:00', '20:00'),
    ('park@example.com', 4, '12:00', '20:00'), ('park@example.com', 5, '08:00', '16:00'),
    ('lee@example.com', 1, '08:00', '14:00'), ('lee@example.com', 3, '08:00', '14:00'),
    ('lee@example.com', 5, '08:00', '17:00'), ('lee@example.com', 6, '08:00', '17:00'),
    ('choi@example.com', 4, '12:00', '20:00'), ('choi@example.com', 5, '12:00', '20:00'), ('choi@example.com', 6, '12:00', '20:00'),
    ('han@example.com', 0, '14:00', '22:00'), ('han@example.com', 1, '14:00', '22:00'), ('han@example.com', 2, '14:00', '22:00'),
    ('han@example.com', 6, '08:00', '14:00')
  ) as a(login, dow, s, e)
  join user_account u on u.login_id = a.login;
update user_account set availability_week = date '2026-11-02'
 where login_id in ('jang@example.com', 'jung@example.com', 'park@example.com', 'lee@example.com', 'choi@example.com', 'han@example.com');
select app.notify_uncovered_slots((select min(store_id) from store), date '2026-11-02');

-- 자체 점검: 음수 재고(기초·기말), 기대한 행 수 -----------------------------------------
do $check$
begin
  if exists (select 1 from forecast_error where period_start >= date '2026-10-12' and (opening_stock < 0 or closing_stock < 0)) then
    raise exception '음수 재고가 나왔습니다. (기초/기말 재고 확인 필요)';
  end if;
  if (select count(*) from forecast_error where period_start in (date '2026-10-12', date '2026-10-19')) <> 16 then
    raise exception '마감 기록이 16건이어야 합니다.';
  end if;
  if not exists (select 1 from sales_forecast where target_week = date '2026-11-02') then
    raise exception '11.02 주 예측이 없습니다.';
  end if;
end $check$;

commit;
