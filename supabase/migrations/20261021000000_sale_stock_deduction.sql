-- 4-1 판매 재고 자동 차감 (이벤트 4-E1) + 4-5 재고 부족 알림 (이벤트 4-E2, 자동 감지)
-- 판매 기록(sale)이 저장되면 레시피 소요량만큼 재고를 줄이고 변동 기록을 남긴다.
-- 레시피가 없는 메뉴는 차감하지 않는다. 테이블은 추가하지 않는다(22개 유지).

-- 레시피 소요량이 소수 셋째 자리(예: 0.018kg)라서, 둘째 자리 반올림으로 누적 오차가 생기지 않게 넓힌다.
alter table inventory        alter column current_qty type numeric(12,3);
alter table inventory_change alter column change_qty  type numeric(12,3);

create or replace function deduct_stock_on_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_qty    numeric;
  v_inv    inventory%rowtype;
  v_ing    ingredient%rowtype;
  v_short  boolean;
begin
  for r in select ingredient_id, qty_per_menu from recipe where menu_id = new.menu_id loop
    v_qty := r.qty_per_menu * new.quantity;

    insert into inventory_change (ingredient_id, change_type, sale_id, change_qty, changed_at)
    values (r.ingredient_id, '판매 차감', new.sale_id, -v_qty, new.sold_at);

    -- 재고 행이 없으면(재료 등록 시 생성되어야 함) 기록만 남기고 넘어간다.
    update inventory
       set current_qty = current_qty - v_qty, updated_at = now()
     where ingredient_id = r.ingredient_id
    returning * into v_inv;
    continue when not found;

    select * into v_ing from ingredient where ingredient_id = r.ingredient_id;
    v_short := v_ing.min_stock is not null and v_inv.current_qty < v_ing.min_stock;

    -- 부족 상태로 "바뀌는 순간"에만 알림을 보낸다(같은 상태에서 판매마다 중복 발송 방지).
    if v_short and not v_inv.is_short then
      insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
      select u.user_id, null, '재고 부족', '자동 감지',
             format('%s 재고(%s%s)가 최소 보유량(%s%s) 아래입니다.',
                    v_ing.ingredient_name, trim_scale(round(v_inv.current_qty, 2)), v_ing.use_unit,
                    trim_scale(v_ing.min_stock), v_ing.use_unit),
             now(), false
        from user_account u
       where u.store_id = v_ing.store_id and u.role in ('점주', '매니저') and u.status = '활성';
    end if;

    if v_short is distinct from v_inv.is_short then
      update inventory set is_short = v_short where inventory_id = v_inv.inventory_id;
    end if;
  end loop;
  return new;
end;
$$;

-- 트리거 함수는 sale INSERT 로만 실행된다. 직접 호출은 막는다.
revoke all on function deduct_stock_on_sale() from public, anon, authenticated;

drop trigger if exists trg_sale_deduct_stock on sale;
create trigger trg_sale_deduct_stock
  after insert on sale
  for each row execute function deduct_stock_on_sale();
