-- '병' 단위 재료를 양을 알 수 있는 단위(L·kg)로 환산한다.
--   바닐라 시럽: 1병 = 0.75 L,  초코 소스: 1병 = 0.5 kg
-- 사용 단위 기준 수량(레시피 소요량·재고·최소 보유량·변동 기록·오차 기록·단가)을 같은 비율로 바꿔 값이 달라지지 않게 한다.
-- 발주 단위는 '병'으로 남고, 환산값(conversion_rate)이 1병당 사용량(0.75 / 0.5)이 된다.
-- 사용 단위가 '병'인 행만 바꾸므로 다시 실행해도 두 번 환산되지 않는다.
create temp table _bottle_conv on commit drop as
select i.ingredient_id, i.store_id, c.new_unit, c.factor
  from public.ingredient i
  join (values ('바닐라 시럽', 'L', 0.75::numeric), ('초코 소스', 'kg', 0.5::numeric)) as c(name, new_unit, factor)
    on c.name = i.ingredient_name
 where i.use_unit = '병';

update public.recipe r set qty_per_menu = round(r.qty_per_menu * c.factor, 4)
  from _bottle_conv c where r.ingredient_id = c.ingredient_id;
update public.inventory v set current_qty = round(v.current_qty * c.factor, 2)
  from _bottle_conv c where v.ingredient_id = c.ingredient_id;
update public.inventory_change h set change_qty = round(h.change_qty * c.factor, 2)
  from _bottle_conv c where h.ingredient_id = c.ingredient_id;
update public.forecast_error e set
       opening_stock = round(e.opening_stock * c.factor, 2), closing_stock = round(e.closing_stock * c.factor, 2),
       actual_usage = round(e.actual_usage * c.factor, 2), forecast_usage = round(e.forecast_usage * c.factor, 2),
       error_qty = round(e.error_qty * c.factor, 2), waste_qty = round(e.waste_qty * c.factor, 2)
  from _bottle_conv c where e.ingredient_id = c.ingredient_id;
update public.order_recommendation o set
       forecast_usage = round(o.forecast_usage * c.factor, 2), stock_at_calc = round(o.stock_at_calc * c.factor, 2)
  from _bottle_conv c where o.ingredient_id = c.ingredient_id;

-- 재료: 단위·1병당 사용량·사용 단위당 단가·최소 보유량 (1병당 가격은 그대로)
update public.ingredient i set
       use_unit = c.new_unit,
       conversion_rate = c.factor,
       unit_price = round(i.unit_price / c.factor),
       min_stock = round(i.min_stock * c.factor, 2)
  from _bottle_conv c where i.ingredient_id = c.ingredient_id;

-- 메뉴 원가 다시 계산 (7-E3)
update public.menu m set cost = c.cost,
       cost_rate = case when m.price = 0 then 0 else least(999.99, round(c.cost::numeric / m.price * 100, 2)) end,
       recipe_status = case when c.cnt = 0 then '미등록' else '등록' end
  from (select mm.menu_id, coalesce(round(sum(r.qty_per_menu * i.unit_price)), 0)::integer cost, count(r.recipe_id) cnt
          from public.menu mm left join public.recipe r using (menu_id) left join public.ingredient i using (ingredient_id)
         where mm.store_id in (select store_id from _bottle_conv) group by mm.menu_id) c
 where m.menu_id = c.menu_id;
