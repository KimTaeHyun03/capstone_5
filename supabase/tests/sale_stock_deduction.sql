-- 4-1 판매 재고 자동 차감 / 4-5 부족 알림 검증 — SQL Editor 에서 실행. 마지막에 rollback 하므로 데이터가 남지 않는다.
-- 기대 1) 카페라떼(menu 2) 1잔 → 원두 -0.018kg, 우유 -0.2L, 컵 -1개, 변동 기록 3건 (원두·우유는 이미 부족이라 알림 없음)
-- 기대 2) 레시피 없는 임시 메뉴 판매 → 변동 기록 0건, 재고 변화 없음
-- 기대 3) 크루아상(재고 42, 최소 30) 13개 판매 → 29 < 30 이 되는 순간 알림 2건(점주·매니저), 이어 1개 더 팔아도 추가 알림 없음
begin;

select ingredient_id, current_qty, is_short from inventory where ingredient_id in (1, 2, 5, 6) order by 1;
select count(*) as noti_before from notification;

-- 1)
insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('TEST-001', 2, now(), 1, 5000);
select ingredient_id, change_type, change_qty from inventory_change
 where sale_id = (select sale_id from sale where payment_no = 'TEST-001') order by 1;

-- 2)
insert into menu (store_id, menu_name, category, price, is_on_sale, recipe_status)
values (1, 'TEST 레시피없음', '시즌', 6000, true, '미등록');
insert into sale (payment_no, menu_id, sold_at, quantity, amount)
values ('TEST-002', (select menu_id from menu where menu_name = 'TEST 레시피없음'), now(), 1, 6000);
select count(*) as changes_for_no_recipe from inventory_change
 where sale_id = (select sale_id from sale where payment_no = 'TEST-002');

-- 3)
insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('TEST-003', 6, now(), 13, 49400);
select count(*) as noti_croissant from notification where content like '크루아상 생지%';
insert into sale (payment_no, menu_id, sold_at, quantity, amount) values ('TEST-004', 6, now(), 1, 3800);
select count(*) as noti_croissant_after_one_more from notification where content like '크루아상 생지%';

select ingredient_id, current_qty, is_short from inventory where ingredient_id in (1, 2, 5, 6) order by 1;
select content from notification where content like '크루아상 생지%' limit 1;

rollback;
