-- 카페 매출·근무표·재고 관리: 22개 테이블 예시 데이터
-- 실행 순서: 20261014000000_init_22_tables.sql → 이 파일
-- Supabase SQL Editor에서 전체 실행. PostgreSQL 전용.
-- 가상 데이터이며 실제 계정/매출이 아닙니다.
-- 재실행 시 동일한 데모 로그인ID가 있으면 전체 실행을 중단합니다.
-- 요일: ISO 기준 월=1 ~ 일=7 / 시간대: 해당 시간의 시작 시각(9=09:00~10:00)
-- 재고·사용량: 사용 단위(g, ml). 발주·입고·추천 수량: 발주 단위(봉, 팩).
-- 단가: 발주 단위당 가격. 메뉴 원가는 레시피 재료비만 포함합니다.
-- 급여는 계산 흐름을 보여주는 단순 예시이며 주휴수당 등 법정 요건 판단용이 아닙니다.
-- password_hash는 로그인 불가능한 데모 표식입니다. 실제 인증은 별도 구현해야 합니다.

begin;
set local search_path = public;
set local time zone 'Asia/Seoul';

do $seed$
declare
    v_store bigint;
    v_owner bigint;
    v_staff bigint;
    v_coffee bigint;
    v_latte bigint;
    v_beans bigint;
    v_milk bigint;
    v_sale1 bigint;
    v_sale2 bigint;
    v_schedule bigint;
    v_assignment bigint;
    v_report bigint;
    v_error bigint;
    v_coefficient bigint;
    v_recommendation bigint;
    v_order bigint;
    v_receipt bigint;
begin
    if exists (select 1 from user_account where login_id in ('demo_cafe_owner', 'demo_cafe_staff')) then
        raise exception '데모 계정이 이미 존재합니다. 중복 삽입 없이 종료합니다.';
    end if;

    -- 1. 매장
    insert into store (store_name, address, phone, open_time, close_time, closed_days)
    values ('5조 데모 카페', '가상시 샘플로 22', '02-0000-0000', '09:00', '18:00', '일요일')
    returning store_id into v_store;

    -- 2. 사용자: 점주 1명, 알바생 1명
    insert into user_account (store_id, login_id, password_hash, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status)
    values (v_store, 'demo_cafe_owner', '!DEMO_LOGIN_DISABLED!', '김점주', '점주', null, null, null, '010-0000-0001', '활성')
    returning user_id into v_owner;
    insert into user_account (store_id, login_id, password_hash, name, role, hourly_wage, max_weekly_hours, preferred_weekly_hours, phone, status)
    values (v_store, 'demo_cafe_staff', '!DEMO_LOGIN_DISABLED!', '이알바', '알바생', 12000, 20, 15, '010-0000-0002', '활성')
    returning user_id into v_staff;

    -- 3. 재료: 원두 1봉=1,000g / 우유 1팩=1,000ml
    insert into ingredient (store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock)
    values (v_store, '에스프레소 원두', 'g', '봉', 1000, 20000, 1000)
    returning ingredient_id into v_beans;
    insert into ingredient (store_id, ingredient_name, use_unit, order_unit, conversion_rate, unit_price, min_stock)
    values (v_store, '우유', 'ml', '팩', 1000, 3000, 2000)
    returning ingredient_id into v_milk;

    -- 4. 메뉴: 아메리카노 원가 360원 / 라테 원가 960원
    insert into menu (store_id, menu_name, category, price, is_on_sale, recipe_status, cost, cost_rate)
    values (v_store, '아메리카노', '커피', 4000, true, '등록완료', 360, 9.00)
    returning menu_id into v_coffee;
    insert into menu (store_id, menu_name, category, price, is_on_sale, recipe_status, cost, cost_rate)
    values (v_store, '카페라테', '커피', 5000, true, '등록완료', 960, 19.20)
    returning menu_id into v_latte;

    -- 5. 레시피: 물·전기·컵 비용은 생략
    insert into recipe (menu_id, ingredient_id, qty_per_menu) values
    (v_coffee, v_beans, 18), (v_latte, v_beans, 18), (v_latte, v_milk, 200);

    -- 6. 판매: 한 결제에서 아메리카노 2잔+라테 1잔=13,000원
    insert into sale (payment_no, menu_id, sold_at, quantity, amount)
    values ('DEMO-' || v_store || '-20261019-001', v_coffee, '2026-10-19 09:30:00+09', 2, 8000)
    returning sale_id into v_sale1;
    insert into sale (payment_no, menu_id, sold_at, quantity, amount)
    values ('DEMO-' || v_store || '-20261019-001', v_latte, '2026-10-19 09:30:00+09', 1, 5000)
    returning sale_id into v_sale2;

    -- 7. 매출 집계: 주문 수는 판매 행 수가 아닌 고유 결제번호 수
    insert into sales_summary (store_id, base_date, day_of_week, time_slot, sales_amount, order_count, is_confirmed)
    values (v_store, '2026-10-19', 1, 9, 13000, 1, true);

    -- 8. 다음 주 예측: 데모용 가정값, 모델 추론 결과 아님
    insert into sales_forecast (store_id, target_week, day_of_week, time_slot, forecast_amount, is_peak, required_staff, needs_more_staff)
    values (v_store, '2026-10-26', 1, 9, 16000, false, 1, false),
           (v_store, '2026-10-26', 1, 12, 45000, true, 2, true);

    -- 9. 근무 가능시간: 매주 월요일
    insert into availability (user_id, day_of_week, start_time, end_time, registered_at)
    values (v_staff, 1, '09:00', '14:00', '2026-10-16 18:00:00+09');

    -- 10. 확정·공개된 이번 주 근무표
    insert into work_schedule (store_id, target_week, status, created_at, confirmed_by, confirmed_at, is_published, published_at)
    values (v_store, '2026-10-19', '확정', '2026-10-17 10:00:00+09', v_owner, '2026-10-17 11:00:00+09', true, '2026-10-17 11:05:00+09')
    returning schedule_id into v_schedule;

    -- 11. 실제 배정: 휴게시간을 포함하지 않는 3시간 근무 예시
    insert into shift_assignment (schedule_id, user_id, work_date, planned_start, planned_end, is_modified, modified_by, has_warning)
    values (v_schedule, v_staff, '2026-10-19', '09:00', '12:00', false, null, false)
    returning assignment_id into v_assignment;

    -- 12. 출퇴근
    insert into attendance (user_id, assignment_id, clock_in, clock_out, actual_hours, status)
    values (v_staff, v_assignment, '2026-10-19 09:00:00+09', '2026-10-19 12:00:00+09', 3.00, '정상');

    -- 13. 하루 정산 예시: 3시간 × 12,000원
    insert into payroll (user_id, period_start, period_end, total_hours, applied_wage, base_pay, is_holiday_pay_target, holiday_pay, total_pay, calculated_at)
    values (v_staff, '2026-10-19', '2026-10-19', 3, 12000, 36000, false, 0, 36000, '2026-10-19 18:00:00+09');

    -- 14. 현재 재고: 원두 900-54+2,000=2,846g / 우유 2,000-200=1,800ml
    insert into inventory (ingredient_id, current_qty, updated_at, is_short) values
    (v_beans, 2846, '2026-10-20 10:00:00+09', false),
    (v_milk, 1800, '2026-10-19 09:30:00+09', true);

    -- 15. 부족 신고: 입고 후 처리 완료된 원두 신고
    insert into shortage_report (ingredient_id, reporter_id, shortage_level, memo, reported_at, status)
    values (v_beans, v_staff, '주의', '원두 846g으로 최소 보유량 1,000g 미만. 다음 날 2봉 입고로 처리 완료.', '2026-10-19 10:00:00+09', '처리완료')
    returning report_id into v_report;

    -- 16. 알림
    insert into notification (recipient_id, report_id, type, source, content, sent_at, is_read) values
    (v_owner, v_report, '재고부족', '수동', '원두 재고가 최소 보유량보다 적습니다.', '2026-10-19 10:00:00+09', true),
    (v_owner, null, '재고부족', '자동', '우유 재고 1,800ml: 최소 보유량 2,000ml 미만입니다.', '2026-10-19 10:01:00+09', false),
    (v_staff, null, '근무표공개', '자동', '10월 19일 주간 근무표가 공개되었습니다.', '2026-10-17 11:05:00+09', false);

    -- 17. 지난주 원두 오차 분석: 해당 기간 입고·폐기 없음
    -- 실제사용=1,900-900=1,000g / 예측=900g / 오차율=(실제-예측)/예측×100
    insert into forecast_error (ingredient_id, period_start, period_end, opening_stock, closing_stock, actual_usage, forecast_usage, error_qty, error_rate, waste_qty)
    values (v_beans, '2026-10-12', '2026-10-18', 1900, 900, 1000, 900, 100, 11.11, 0)
    returning error_id into v_error;

    -- 18. 보정계수: 예측 900g × 1.1=990g (데모용 완화 보정)
    insert into correction_coefficient (ingredient_id, error_id, previous_value, coefficient, qty_before, qty_after, effective_from, applied_at)
    values (v_beans, v_error, 1.000, 1.100, 900, 990, '2026-10-19', '2026-10-19 10:05:00+09')
    returning coefficient_id into v_coefficient;

    -- 19. 발주 추천: ceil((990+최소재고1,000-현재846)/1,000)=2봉
    insert into order_recommendation (ingredient_id, coefficient_id, period_start, period_end, forecast_usage, stock_at_calc, recommended_qty, estimated_cost, calculated_at)
    values (v_beans, v_coefficient, '2026-10-19', '2026-10-25', 990, 846, 2, 40000, '2026-10-19 10:10:00+09')
    returning recommendation_id into v_recommendation;

    -- 20. 발주
    insert into purchase_order (ingredient_id, recommendation_id, ordered_by, order_qty, is_adjusted, status, ordered_at)
    values (v_beans, v_recommendation, v_owner, 2, false, '입고완료', '2026-10-19 10:20:00+09')
    returning order_id into v_order;

    -- 21. 입고: 발주 대비 차이 없음
    insert into receipt (order_id, handled_by, received_qty, diff_qty, diff_reason, received_at)
    values (v_order, v_staff, 2, 0, null, '2026-10-20 10:00:00+09')
    returning receipt_id into v_receipt;

    -- 22. 재고 변동: 초기 입고 → 지난주 사용 → 이번 주 판매 → 발주 입고
    insert into inventory_change (ingredient_id, change_type, sale_id, receipt_id, change_qty, reason, handled_by, changed_at) values
    (v_beans, '초기등록', null, null, 1900, '지난주 시작 재고', v_owner, '2026-10-12 08:50:00+09'),
    (v_milk, '초기등록', null, null, 2000, '예시 시작 재고', v_owner, '2026-10-12 08:50:00+09'),
    (v_beans, '사용', null, null, -1000, '지난주 사용 합계: 이전 기간 판매 상세는 생략', v_owner, '2026-10-18 18:00:00+09'),
    (v_beans, '판매차감', v_sale1, null, -36, '아메리카노 2잔 × 원두 18g', null, '2026-10-19 09:30:00+09'),
    (v_beans, '판매차감', v_sale2, null, -18, '카페라테 1잔 × 원두 18g', null, '2026-10-19 09:30:00+09'),
    (v_milk, '판매차감', v_sale2, null, -200, '카페라테 1잔 × 우유 200ml', null, '2026-10-19 09:30:00+09'),
    (v_beans, '입고', null, v_receipt, 2000, '원두 2봉 × 1,000g', v_staff, '2026-10-20 10:00:00+09');

    raise notice '데모 생성 완료: 매장 ID %, 점주 ID %, 직원 ID %', v_store, v_owner, v_staff;
end;
$seed$;

commit;

-- 확인: 이번 파일로 생성한 데모 매장의 재고와 변동 합계 비교
select i.ingredient_name, i.use_unit, inv.current_qty,
       sum(c.change_qty) as change_total,
       inv.current_qty = sum(c.change_qty) as is_consistent
from store s
join ingredient i on i.store_id = s.store_id
join inventory inv on inv.ingredient_id = i.ingredient_id
join inventory_change c on c.ingredient_id = i.ingredient_id
where exists (select 1 from user_account u where u.store_id = s.store_id and u.login_id = 'demo_cafe_owner')
group by i.ingredient_id, i.ingredient_name, i.use_unit, inv.current_qty;
