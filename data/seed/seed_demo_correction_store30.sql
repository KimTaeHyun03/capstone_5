-- 투썸 수원천천점(store 30) 예측 오차 보정 시연용 가공 데이터
-- ※ 실제 계산 결과가 아니라 시연을 위해 만든 값이다. 시연할 때 "시연용으로 조정한 데이터"라고 밝힌다.
--
-- 이유: 이 매장의 첫 마감(10.19~10.25)은 그 주에 계산해 둔 권장량이 없어서 예측=실제(오차 0%, 계수 1.00)로 기록됐다.
-- 한 일:
--   1) 10.12~10.18 주 마감 기록을 새로 넣는다. 실제 소진량은 그 주 판매 차감 기록(inventory_change)에서 읽는다.
--   2) 10.19~10.25 주 기록의 예측 소진량·폐기량을 재료별로 실제와 조금씩 어긋나게 고친다. 실제 소진량은 그대로.
--   3) 보정 계수는 close_period·calculate_correction_coefficients 와 같은 식(최근 3기간 실제 합 ÷ 예측 합, 0.80~1.20)으로 만든다.
--   10.12~10.18 계수 행(적용 10.19)을 추가하고, 이미 있던 10.19~10.25 계수 행(적용 10.26)은 값만 고친다.
-- 다시 실행해도 안전하다(10.12~10.18 기록이 이미 있으면 건너뛰고 나머지는 같은 값으로 덮어쓴다).
-- 끝낸 뒤 권장 발주 화면에서 '지금 재고로 다시 계산'을 눌러야 새 보정 계수가 권장량에 반영된다.

begin;

create temp table _demo (name text primary key, r1 numeric, r2 numeric, w1 numeric, w2 numeric) on commit drop;
-- r = 실제 ÷ 예측 (1보다 작으면 예측이 컸던 것), w = 폐기량(그 재료의 사용 단위)
insert into _demo values
  ('원두',        0.96, 1.02, 0,   0),
  ('우유',        1.02, 0.97, 1,   2),
  ('바닐라 시럽', 1.00, 0.96, 0,   0),
  ('생크림',      0.91, 0.92, 0.3, 0.5),
  ('크루아상 생지', 0.90, 0.93, 3,   4),
  ('컵 12oz',     0.98, 0.99, 0,   0),
  ('초코 소스',   1.05, 1.08, 0,   0),
  ('레몬',        0.87, 0.91, 3,   2);

-- 1) 10.12~10.18 주 마감 기록
insert into forecast_error (ingredient_id, period_start, period_end, opening_stock, closing_stock, actual_usage, forecast_usage, error_qty, error_rate, waste_qty)
select i.ingredient_id, date '2026-10-12', date '2026-10-18',
       round(i.min_stock * 1.5 + s.act, 2), round(i.min_stock * 1.5, 2),
       round(s.act, 2), round(s.act / d.r1, 2),
       round(s.act / d.r1 - s.act, 2), round((s.act / d.r1 - s.act) / (s.act / d.r1) * 100, 2), d.w1
  from ingredient i
  join _demo d on d.name = i.ingredient_name
  cross join lateral (
    select coalesce(-sum(c.change_qty), 0) as act from inventory_change c
     where c.ingredient_id = i.ingredient_id and c.change_type = '판매 차감'
       and c.changed_at >= timestamptz '2026-10-12 00:00+09' and c.changed_at < timestamptz '2026-10-19 00:00+09') s
 where i.store_id = 30 and s.act > 0
   and not exists (select 1 from forecast_error e where e.ingredient_id = i.ingredient_id and e.period_start = date '2026-10-12' and e.period_end = date '2026-10-18');

-- 2) 10.19~10.25 주: 예측·폐기·기초/기말 재고를 고친다(실제 소진량은 그대로)
update forecast_error e
   set forecast_usage = round(e.actual_usage / d.r2, 2),
       error_qty = round(e.actual_usage / d.r2 - e.actual_usage, 2),
       error_rate = round((e.actual_usage / d.r2 - e.actual_usage) / (e.actual_usage / d.r2) * 100, 2),
       waste_qty = d.w2,
       closing_stock = round(i.min_stock * 1.5, 2),
       opening_stock = round(i.min_stock * 1.5 + e.actual_usage, 2)
  from ingredient i, _demo d
 where i.ingredient_id = e.ingredient_id and i.store_id = 30 and d.name = i.ingredient_name
   and e.period_start = date '2026-10-19' and e.period_end = date '2026-10-25';

-- 3) 보정 계수: 10.12~10.18 만으로 → 적용 10.19, 두 기간 합 → 기존 행(적용 10.26) 값 수정
insert into correction_coefficient (ingredient_id, error_id, previous_value, coefficient, effective_from, applied_at)
select e.ingredient_id, e.error_id, 1,
       least(1.2, greatest(0.8, round(e.actual_usage / nullif(e.forecast_usage, 0), 3))),
       date '2026-10-19', timestamptz '2026-10-19 00:30+09'
  from forecast_error e join ingredient i using (ingredient_id)
 where i.store_id = 30 and e.period_start = date '2026-10-12' and e.period_end = date '2026-10-18'
   and not exists (select 1 from correction_coefficient c where c.error_id = e.error_id);

update correction_coefficient c
   set previous_value = a.coefficient,
       coefficient = least(1.2, greatest(0.8, round(t.act / nullif(t.fc, 0), 3)))
  from forecast_error b
  join forecast_error a0 on a0.ingredient_id = b.ingredient_id and a0.period_start = date '2026-10-12' and a0.period_end = date '2026-10-18'
  join correction_coefficient a on a.error_id = a0.error_id
  cross join lateral (select sum(x.actual_usage) as act, sum(x.forecast_usage) as fc from forecast_error x
                       where x.ingredient_id = b.ingredient_id and x.period_end <= date '2026-10-25') t
 where c.error_id = b.error_id and b.period_start = date '2026-10-19' and b.period_end = date '2026-10-25'
   and exists (select 1 from ingredient i where i.ingredient_id = b.ingredient_id and i.store_id = 30);

-- 결과 확인
select i.ingredient_name, e.period_start, e.forecast_usage, e.actual_usage, e.error_rate, e.waste_qty, c.previous_value, c.coefficient, c.effective_from
  from forecast_error e join ingredient i using (ingredient_id)
  left join correction_coefficient c on c.error_id = e.error_id
 where i.store_id = 30 order by i.ingredient_id, e.period_start;

commit;
