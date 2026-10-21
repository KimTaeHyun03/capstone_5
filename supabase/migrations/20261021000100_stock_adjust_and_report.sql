-- 4-3 실사·폐기 기록 (이벤트 4-E3), 4-4 부족 직접 신고 + 4-5 알림 (이벤트 4-E2, 수동 신고)
-- 재고를 바꾸는 로직을 apply_stock_delta 한 곳으로 모은다(판매 차감·실사·폐기, 이후 입고도 사용).
-- 테이블은 추가하지 않는다(22개 유지). 화면의 쓰기는 모두 아래 함수(RPC)를 통한다.

-- 재고 증감 + 부족 여부 갱신 + 부족 전환 시 알림. 변동 기록(inventory_change)은 호출하는 쪽이 남긴다.
create or replace function apply_stock_delta(p_ingredient_id bigint, p_delta numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv    inventory%rowtype;
  v_ing    ingredient%rowtype;
  v_short  boolean;
begin
  update inventory
     set current_qty = current_qty + p_delta, updated_at = now()
   where ingredient_id = p_ingredient_id
  returning * into v_inv;
  if not found then return; end if; -- 재고 행이 없는 재료(재료 등록 시 생성되어야 함)

  select * into v_ing from ingredient where ingredient_id = p_ingredient_id;
  v_short := v_ing.min_stock is not null and v_inv.current_qty < v_ing.min_stock;

  -- 부족 상태로 "바뀌는 순간"에만 알림을 보낸다(같은 상태에서 중복 발송 방지).
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
end;
$$;

-- 판매 차감 트리거가 공통 함수를 쓰도록 바꾼다(동작은 동일).
create or replace function deduct_stock_on_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_qty  numeric;
begin
  for r in select ingredient_id, qty_per_menu from recipe where menu_id = new.menu_id loop
    v_qty := r.qty_per_menu * new.quantity;
    insert into inventory_change (ingredient_id, change_type, sale_id, change_qty, changed_at)
    values (r.ingredient_id, '판매 차감', new.sale_id, -v_qty, new.sold_at);
    perform apply_stock_delta(r.ingredient_id, -v_qty);
  end loop;
  return new;
end;
$$;

-- 4-3: 실사('실사 보정', p_qty = 실제로 센 수량) 또는 폐기('폐기', p_qty = 버린 수량). 반영 후 재고를 돌려준다.
create or replace function record_stock_adjustment(
  p_ingredient_id bigint, p_type text, p_qty numeric, p_user_id bigint, p_reason text default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur    numeric;
  v_delta  numeric;
begin
  if p_type not in ('실사 보정', '폐기') then
    raise exception '지원하지 않는 변동 유형입니다: %', p_type;
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception '수량은 0 이상이어야 합니다.';
  end if;

  select current_qty into v_cur from inventory where ingredient_id = p_ingredient_id for update;
  if not found then
    raise exception '재고 정보가 없는 재료입니다: %', p_ingredient_id;
  end if;

  if p_type = '폐기' then
    if p_qty > v_cur then
      raise exception '현재 재고(%)보다 많이 폐기할 수 없습니다.', trim_scale(v_cur);
    end if;
    v_delta := -p_qty;
  else
    v_delta := p_qty - v_cur;
  end if;

  if v_delta = 0 then return v_cur; end if; -- 차이 없으면 기록하지 않는다

  insert into inventory_change (ingredient_id, change_type, change_qty, reason, handled_by, changed_at)
  values (p_ingredient_id, p_type, v_delta, p_reason, p_user_id, now());
  perform apply_stock_delta(p_ingredient_id, v_delta);
  return v_cur + v_delta;
end;
$$;

-- 4-4: 부족 신고 접수 → 점주·매니저에게 알림(수동 신고, report_id 연결)
create or replace function submit_shortage_report(
  p_ingredient_id bigint, p_reporter_id bigint, p_level text default null, p_memo text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    bigint;
  v_ing   ingredient%rowtype;
  v_name  text;
begin
  select * into v_ing from ingredient where ingredient_id = p_ingredient_id;
  if not found then raise exception '없는 재료입니다: %', p_ingredient_id; end if;
  select name into v_name from user_account where user_id = p_reporter_id;
  if not found then raise exception '없는 사용자입니다: %', p_reporter_id; end if;

  insert into shortage_report (ingredient_id, reporter_id, shortage_level, memo, reported_at, status)
  values (p_ingredient_id, p_reporter_id, p_level, nullif(trim(p_memo), ''), now(), '접수')
  returning report_id into v_id;

  insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, v_id, '재고 부족', '수동 신고',
         format('%s 부족 신고가 접수되었습니다. (신고자: %s)', v_ing.ingredient_name, v_name), now(), false
    from user_account u
   where u.store_id = v_ing.store_id and u.role in ('점주', '매니저') and u.status = '활성';
  return v_id;
end;
$$;

-- 신고 확인 처리 (점주·매니저)
create or replace function resolve_shortage_report(p_report_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update shortage_report set status = '확인' where report_id = p_report_id and status = '접수';
$$;

-- 알림 모두 읽음
create or replace function mark_notifications_read(p_user_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update notification set is_read = true where recipient_id = p_user_id and not is_read;
$$;

-- 내부 함수는 직접 호출을 막는다. 화면에서 부르는 함수의 실행 권한은 별도(개발용 임시/인증 후 정식)로 준다.
revoke all on function apply_stock_delta(bigint, numeric) from public, anon, authenticated;
revoke all on function record_stock_adjustment(bigint, text, numeric, bigint, text) from public, anon, authenticated;
revoke all on function submit_shortage_report(bigint, bigint, text, text) from public, anon, authenticated;
revoke all on function resolve_shortage_report(bigint) from public, anon, authenticated;
revoke all on function mark_notifications_read(bigint) from public, anon, authenticated;
