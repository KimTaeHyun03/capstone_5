-- 5-1 권장 발주량 / 5-2 발주 등록 / 5-3 입고 처리 검증 — 끝에 rollback 하므로 데이터가 남지 않는다.
-- 앞선 마이그레이션이 모두 적용돼 있어야 한다.
-- 기대 1) 산출: 재료 8건 생성. 권장량은 발주 단위(원두 1, 우유 12, 크루아상 20, 컵 500)의 배수이고 음수가 없다.
-- 기대 2) 발주: 권장량을 고치면 is_adjusted=true. 단위 배수가 아니거나 0 이하이면 오류.
-- 기대 3) 입고: 상태 '입고완료', 재고 가산(원두 4 → 13, 부족 해제), 변동 기록 '입고', 점주 알림. 같은 발주 재입고는 오류.
begin;
set local role anon;

select calculate_order_recommendations('2026-10-26') as made;
select i.ingredient_name, r.forecast_usage, c.coefficient as factor, r.stock_at_calc, r.recommended_qty, r.estimated_cost,
       (r.recommended_qty = 0 or mod(r.recommended_qty, i.conversion_rate) = 0) as unit_ok
  from order_recommendation r
  join ingredient i using (ingredient_id)
  left join correction_coefficient c using (coefficient_id)
 where r.period_start = '2026-10-26' order by i.ingredient_id;

-- 2) 발주: 원두 권장량 그대로, 우유는 일부러 조정(12 단위)
select recommendation_id as rec_bean from order_recommendation where period_start = '2026-10-26' and ingredient_id = 1 \gset
select recommendation_id as rec_milk from order_recommendation where period_start = '2026-10-26' and ingredient_id = 2 \gset
select recommended_qty as q_bean from order_recommendation where recommendation_id = :rec_bean \gset
select place_purchase_order(2, jsonb_build_array(
  jsonb_build_object('ingredient_id', 1, 'recommendation_id', :rec_bean, 'qty', :q_bean),
  jsonb_build_object('ingredient_id', 2, 'recommendation_id', :rec_milk, 'qty', 24))) as first_order \gset
select ingredient_id, order_qty, is_adjusted, status from purchase_order where order_id >= :first_order order by order_id;

do $$ begin
  perform place_purchase_order(2, '[{"ingredient_id":2,"qty":10}]'::jsonb);
  raise exception '단위 위반이 통과했습니다';
exception when others then
  if sqlerrm like '%배수%' then raise notice '단위 배수 검증 OK: %', sqlerrm; else raise; end if;
end $$;
do $$ begin
  perform place_purchase_order(2, '[{"ingredient_id":1,"qty":0}]'::jsonb);
  raise exception '0 수량이 통과했습니다';
exception when others then
  if sqlerrm like '%0보다%' then raise notice '0 수량 거부 OK'; else raise; end if;
end $$;

-- 3) 입고 (원두는 발주량 그대로, 우유는 2 적게 받음)
select count(*) as noti_before from notification;
select receive_purchase_order(2, jsonb_build_array(
  jsonb_build_object('order_id', :first_order, 'received_qty', :q_bean),
  jsonb_build_object('order_id', :first_order + 1, 'received_qty', 22, 'diff_reason', '2L 파손'))) as received;
reset role;
select ingredient_id, current_qty, is_short from inventory where ingredient_id in (1, 2) order by 1;
select p.ingredient_id, p.status, r.received_qty, r.diff_qty, r.diff_reason
  from purchase_order p join receipt r using (order_id) where p.order_id >= :first_order order by p.order_id;
select ingredient_id, change_type, change_qty, handled_by from inventory_change where change_type = '입고' order by ingredient_id;
select count(*) as noti_after from notification;
set local role anon;
do $$ begin
  perform receive_purchase_order(2, jsonb_build_array(jsonb_build_object('order_id', (select min(order_id) from purchase_order), 'received_qty', 1)));
  raise exception '재입고가 통과했습니다';
exception when others then
  if sqlerrm like '이미 입고%' then raise notice '재입고 거부 OK'; else raise; end if;
end $$;

reset role;
rollback;
