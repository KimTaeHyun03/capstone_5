-- 5-1 권장 발주량 산출 (이벤트 5-E1), 5-2 발주 등록 (5-E2), 5-3 입고 처리 (5-E4·E5)
-- 테이블은 추가하지 않는다(22개 유지). 화면의 쓰기는 모두 아래 함수(RPC)를 통한다.
--
-- 권장 발주량 = 예상 소진량 × 보정 계수 − 현재 재고, 발주 단위(conversion_rate)로 올림, 음수면 0
--   (화면 문구·시드 order_recommendation 의 정의와 같다. 안전재고는 더하지 않는다.)
-- 예상 소진량 = 가장 최근 마감 기간의 실제 소진량(forecast_error.actual_usage)
--               × (대상 주 예측 매출 ÷ 그 기간 실제 매출), 비율은 0.8 ~ 1.2 로 제한. 예측 매출이 없으면 비율 1.
--               마감 기록이 없으면 최근 7일 판매 차감량으로 대신한다.
-- 수량 단위는 사용 단위(use_unit)이고, 발주·입고 수량도 같은 단위다(발주 단위의 배수).
-- 발주 한 건(여러 품목)은 purchase_order 행이 품목별로 하나씩이며, 같은 ordered_at 으로 묶는다.

create or replace function calculate_order_recommendations(p_period_start date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start   date := coalesce(p_period_start, (date_trunc('week', current_date) + interval '7 days')::date);
  v_end     date := v_start + 6;
  r         record;
  fe        forecast_error%rowtype;
  v_coef    correction_coefficient%rowtype;
  v_stock   numeric;
  v_base    numeric;
  v_ratio   numeric;
  v_fc      numeric;
  v_sales   numeric;
  v_use     numeric;
  v_factor  numeric;
  v_conv    numeric;
  v_raw     numeric;
  v_rec     numeric;
  v_n       integer := 0;
begin
  select coalesce(sum(forecast_amount), 0) into v_fc
    from sales_forecast where target_week = v_start;

  for r in select * from ingredient order by ingredient_id loop
    select coalesce(current_qty, 0) into v_stock from inventory where ingredient_id = r.ingredient_id;
    v_stock := coalesce(v_stock, 0);

    -- 예상 소진량
    select * into fe from forecast_error
     where ingredient_id = r.ingredient_id and period_end < v_start
     order by period_end desc limit 1;
    if found then
      v_base := fe.actual_usage;
      select coalesce(sum(sales_amount), 0) into v_sales from sales_summary
       where store_id = r.store_id and base_date between fe.period_start and fe.period_end;
      v_ratio := case when v_fc > 0 and v_sales > 0 then least(1.2, greatest(0.8, v_fc / v_sales)) else 1 end;
    else
      select coalesce(sum(-change_qty), 0) into v_base from inventory_change
       where ingredient_id = r.ingredient_id and change_type = '판매 차감'
         and changed_at >= (v_start::timestamptz - interval '7 days');
      v_ratio := 1;
    end if;
    v_use := round(v_base * v_ratio, 2);

    -- 보정 계수: 대상 기간 시작일에 유효한 가장 최근 행
    select * into v_coef from correction_coefficient
     where ingredient_id = r.ingredient_id and effective_from <= v_start
     order by effective_from desc, applied_at desc limit 1;
    v_factor := coalesce(v_coef.coefficient, 1);

    v_conv := coalesce(nullif(r.conversion_rate, 0), 1);
    v_raw := v_use * v_factor - v_stock;
    v_rec := case when v_raw <= 0 then 0 else ceil(v_raw / v_conv) * v_conv end;

    insert into order_recommendation
      (ingredient_id, coefficient_id, period_start, period_end, forecast_usage, stock_at_calc,
       recommended_qty, estimated_cost, calculated_at)
    values (r.ingredient_id, v_coef.coefficient_id, v_start, v_end, v_use, v_stock,
            v_rec, round(v_rec * coalesce(r.unit_price, 0)), now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 5-2 발주 등록: p_lines = [{ "ingredient_id": 1, "recommendation_id": 3, "qty": 10 }, ...]  → '대기' 로 저장. 첫 발주 ID 반환.
create or replace function place_purchase_order(p_user_id bigint, p_lines jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  l        jsonb;
  v_ing    ingredient%rowtype;
  v_rec    order_recommendation%rowtype;
  v_qty    numeric;
  v_conv   numeric;
  v_id     bigint;
  v_first  bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '발주할 품목이 없습니다.';
  end if;
  perform 1 from user_account where user_id = p_user_id;
  if not found then raise exception '없는 사용자입니다: %', p_user_id; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into v_ing from ingredient where ingredient_id = (l->>'ingredient_id')::bigint;
    if not found then raise exception '없는 재료입니다: %', l->>'ingredient_id'; end if;
    v_qty := (l->>'qty')::numeric;
    v_conv := coalesce(nullif(v_ing.conversion_rate, 0), 1);
    if v_qty is null or v_qty <= 0 then raise exception '% 발주 수량은 0보다 커야 합니다.', v_ing.ingredient_name; end if;
    if mod(v_qty, v_conv) <> 0 then
      raise exception '% 발주 수량은 발주 단위(%)의 배수여야 합니다.', v_ing.ingredient_name, trim_scale(v_conv);
    end if;

    v_rec := null;
    if l->>'recommendation_id' is not null then
      select * into v_rec from order_recommendation
       where recommendation_id = (l->>'recommendation_id')::bigint and ingredient_id = v_ing.ingredient_id;
    end if;

    insert into purchase_order (ingredient_id, recommendation_id, ordered_by, order_qty, is_adjusted, status, ordered_at)
    values (v_ing.ingredient_id, v_rec.recommendation_id, p_user_id, v_qty,
            v_rec.recommendation_id is not null and v_qty <> v_rec.recommended_qty, '대기', now())
    returning order_id into v_id;
    v_first := coalesce(v_first, v_id);
  end loop;
  return v_first;
end;
$$;

-- 5-3 입고 처리: p_lines = [{ "order_id": 5, "received_qty": 10, "diff_reason": "..." }, ...]
create or replace function receive_purchase_order(p_user_id bigint, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l       jsonb;
  v_po    purchase_order%rowtype;
  v_qty   numeric;
  v_n     integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '입고할 품목이 없습니다.';
  end if;
  perform 1 from user_account where user_id = p_user_id;
  if not found then raise exception '없는 사용자입니다: %', p_user_id; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into v_po from purchase_order where order_id = (l->>'order_id')::bigint for update;
    if not found then raise exception '없는 발주입니다: %', l->>'order_id'; end if;
    if v_po.status <> '대기' then raise exception '이미 입고 처리된 발주입니다: %', v_po.order_id; end if;
    v_qty := (l->>'received_qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception '입고 수량은 0 이상이어야 합니다.'; end if;

    -- 상태 전환·재고 가산·변동 기록은 receipt INSERT 트리거가 처리한다.
    insert into receipt (order_id, handled_by, received_qty, diff_qty, diff_reason, received_at)
    values (v_po.order_id, p_user_id, v_qty, v_qty - v_po.order_qty,
            nullif(trim(l->>'diff_reason'), ''), now());
    v_n := v_n + 1;
  end loop;

  insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read)
  select u.user_id, null, '입고 완료', '자동 감지',
         format('발주 입고가 완료되어 재고에 반영됐습니다. (%s개 품목)', v_n), now(), false
    from user_account u
   where u.store_id = (select store_id from user_account where user_id = p_user_id)
     and u.role = '점주' and u.status = '활성';
  return v_n;
end;
$$;

-- 이벤트 5-E4·E5: 입고 기록이 저장되면 발주를 입고완료로 바꾸고 재고에 더한다.
create or replace function apply_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ing bigint;
begin
  update purchase_order set status = '입고완료'
   where order_id = new.order_id and status = '대기'
  returning ingredient_id into v_ing;
  if not found then
    raise exception '입고 대기 상태가 아닌 발주입니다: %', new.order_id;
  end if;

  if new.received_qty > 0 then
    insert into inventory_change (ingredient_id, change_type, receipt_id, change_qty, handled_by, changed_at)
    values (v_ing, '입고', new.receipt_id, new.received_qty, new.handled_by, new.received_at);
    perform apply_stock_delta(v_ing, new.received_qty);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_receipt_apply on receipt;
create trigger trg_receipt_apply
  after insert on receipt
  for each row execute function apply_receipt();

-- 직접 호출은 막는다. 화면용 실행 권한은 별도(개발용 임시/인증 후 정식)로 준다.
revoke all on function calculate_order_recommendations(date) from public, anon, authenticated;
revoke all on function place_purchase_order(bigint, jsonb) from public, anon, authenticated;
revoke all on function receive_purchase_order(bigint, jsonb) from public, anon, authenticated;
revoke all on function apply_receipt() from public, anon, authenticated;
