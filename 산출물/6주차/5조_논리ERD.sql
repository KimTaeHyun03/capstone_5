-- =====================================================================
-- 5조 카페·식당 매출예측·근무표 자동화 솔루션 — 테이블설계(논리) ERD
-- 기준: 5조_테이블설계개념_수정.docx (테이블 22개)
-- 문법: MySQL 8 (ERD 사이트 Import용). 테이블·컬럼 한글명은 COMMENT에 있음
-- 관계는 맨 아래 ALTER TABLE ... FOREIGN KEY 로 정의 (모두 1:N, 재고 현황만 1:1)
-- 타입은 Import를 위해 임시로 붙인 것 — 최종 타입은 테이블설계(물리)에서 확정
-- =====================================================================

-- ---------------------------------------------------------------------
-- 기초 정보
-- ---------------------------------------------------------------------
CREATE TABLE store (
    store_id        BIGINT       NOT NULL AUTO_INCREMENT COMMENT '매장ID',
    store_name      VARCHAR(100) NOT NULL COMMENT '매장명',
    address         VARCHAR(255)          COMMENT '주소',
    phone           VARCHAR(20)           COMMENT '연락처',
    open_time       TIME                  COMMENT '영업 시작 시각',
    close_time      TIME                  COMMENT '영업 종료 시각',
    closed_days     VARCHAR(50)           COMMENT '휴무일',
    PRIMARY KEY (store_id)
) COMMENT '매장';

CREATE TABLE user_account (
    user_id                 BIGINT       NOT NULL AUTO_INCREMENT COMMENT '사용자ID',
    store_id                BIGINT       NOT NULL COMMENT '매장ID(FK)',
    login_id                VARCHAR(50)  NOT NULL COMMENT '로그인ID',
    password_hash           VARCHAR(255) NOT NULL COMMENT '비밀번호(암호화)',
    name                    VARCHAR(50)  NOT NULL COMMENT '이름',
    role                    VARCHAR(20)  NOT NULL COMMENT '역할(점주·매니저·알바생)',
    hourly_wage             INT                   COMMENT '시급',
    max_weekly_hours        DECIMAL(4,1)          COMMENT '주 최대 근무시간',
    preferred_weekly_hours  DECIMAL(4,1)          COMMENT '주 희망 근무시간',
    phone                   VARCHAR(20)           COMMENT '연락처',
    status                  VARCHAR(20)  NOT NULL COMMENT '계정 상태(초대됨·활성·비활성)',
    PRIMARY KEY (user_id),
    UNIQUE KEY uk_user_login_id (login_id)
) COMMENT '사용자 계정';

CREATE TABLE menu (
    menu_id         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '메뉴ID',
    store_id        BIGINT       NOT NULL COMMENT '매장ID(FK)',
    menu_name       VARCHAR(100) NOT NULL COMMENT '메뉴명',
    category        VARCHAR(50)           COMMENT '분류',
    price           INT          NOT NULL COMMENT '판매가',
    is_on_sale      BOOLEAN      NOT NULL COMMENT '판매 여부',
    recipe_status   VARCHAR(20)           COMMENT '레시피 등록 상태',
    cost            INT                   COMMENT '원가',
    cost_rate       DECIMAL(5,2)          COMMENT '원가율(%)',
    PRIMARY KEY (menu_id)
) COMMENT '메뉴';

CREATE TABLE ingredient (
    ingredient_id   BIGINT        NOT NULL AUTO_INCREMENT COMMENT '재료ID',
    store_id        BIGINT        NOT NULL COMMENT '매장ID(FK)',
    ingredient_name VARCHAR(100)  NOT NULL COMMENT '재료명',
    use_unit        VARCHAR(20)   NOT NULL COMMENT '사용 단위',
    order_unit      VARCHAR(20)   NOT NULL COMMENT '발주 단위',
    conversion_rate DECIMAL(10,3)          COMMENT '환산값(발주 단위당 사용량)',
    unit_price      INT                    COMMENT '단가',
    min_stock       DECIMAL(10,2)          COMMENT '최소 보유량',
    PRIMARY KEY (ingredient_id)
) COMMENT '재료';

CREATE TABLE recipe (
    recipe_id       BIGINT        NOT NULL AUTO_INCREMENT COMMENT '레시피ID',
    menu_id         BIGINT        NOT NULL COMMENT '메뉴ID(FK)',
    ingredient_id   BIGINT        NOT NULL COMMENT '재료ID(FK)',
    qty_per_menu    DECIMAL(10,3) NOT NULL COMMENT '1개당 소요량(재료 사용 단위)',
    PRIMARY KEY (recipe_id),
    UNIQUE KEY uk_recipe_menu_ingredient (menu_id, ingredient_id)
) COMMENT '레시피';

-- ---------------------------------------------------------------------
-- 매출
-- ---------------------------------------------------------------------
CREATE TABLE sale (
    sale_id         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '판매ID',
    payment_no      VARCHAR(30)  NOT NULL COMMENT '결제번호(한 결제의 여러 메뉴를 묶음)',
    menu_id         BIGINT       NOT NULL COMMENT '메뉴ID(FK)',
    sold_at         DATETIME     NOT NULL COMMENT '판매 일시',
    quantity        INT          NOT NULL COMMENT '수량',
    amount          INT          NOT NULL COMMENT '판매 금액',
    PRIMARY KEY (sale_id)
) COMMENT '판매 기록';

CREATE TABLE sales_summary (
    summary_id      BIGINT       NOT NULL AUTO_INCREMENT COMMENT '집계ID',
    store_id        BIGINT       NOT NULL COMMENT '매장ID(FK)',
    base_date       DATE         NOT NULL COMMENT '기준 일자',
    day_of_week     TINYINT      NOT NULL COMMENT '요일',
    time_slot       TINYINT      NOT NULL COMMENT '시간대',
    sales_amount    INT          NOT NULL COMMENT '매출액',
    order_count     INT          NOT NULL COMMENT '주문 건수',
    is_confirmed    BOOLEAN      NOT NULL COMMENT '확정 여부',
    PRIMARY KEY (summary_id),
    UNIQUE KEY uk_summary_slot (store_id, base_date, time_slot)
) COMMENT '매출 집계';

CREATE TABLE sales_forecast (
    forecast_id      BIGINT      NOT NULL AUTO_INCREMENT COMMENT '예측ID',
    store_id         BIGINT      NOT NULL COMMENT '매장ID(FK)',
    target_week      DATE        NOT NULL COMMENT '대상 주차(주 시작일)',
    day_of_week      TINYINT     NOT NULL COMMENT '요일',
    time_slot        TINYINT     NOT NULL COMMENT '시간대',
    forecast_amount  INT         NOT NULL COMMENT '예측 매출액',
    is_peak          BOOLEAN     NOT NULL COMMENT '피크타임 여부',
    required_staff   INT                  COMMENT '필요 인원 수',
    needs_more_staff BOOLEAN              COMMENT '증원 검토 여부',
    PRIMARY KEY (forecast_id)
) COMMENT '매출 예측';

-- ---------------------------------------------------------------------
-- 근무 스케줄
-- ---------------------------------------------------------------------
CREATE TABLE availability (
    availability_id BIGINT       NOT NULL AUTO_INCREMENT COMMENT '가능시간ID',
    user_id         BIGINT       NOT NULL COMMENT '사용자ID(FK)',
    day_of_week     TINYINT      NOT NULL COMMENT '요일',
    start_time      TIME         NOT NULL COMMENT '시작 시각',
    end_time        TIME         NOT NULL COMMENT '종료 시각',
    registered_at   DATETIME     NOT NULL COMMENT '등록 일시',
    PRIMARY KEY (availability_id)
) COMMENT '근무 가능시간';

CREATE TABLE work_schedule (
    schedule_id     BIGINT       NOT NULL AUTO_INCREMENT COMMENT '스케줄ID',
    store_id        BIGINT       NOT NULL COMMENT '매장ID(FK)',
    target_week     DATE         NOT NULL COMMENT '대상 주차(주 시작일)',
    status          VARCHAR(20)  NOT NULL COMMENT '상태(초안·검토중·확정)',
    created_at      DATETIME     NOT NULL COMMENT '생성 일시',
    confirmed_by    BIGINT                COMMENT '확정자(사용자ID FK)',
    confirmed_at    DATETIME              COMMENT '확정 일시',
    is_published    BOOLEAN      NOT NULL COMMENT '공개 여부',
    published_at    DATETIME              COMMENT '공개 일시',
    PRIMARY KEY (schedule_id),
    UNIQUE KEY uk_schedule_week (store_id, target_week)
) COMMENT '근무 스케줄';

CREATE TABLE shift_assignment (
    assignment_id   BIGINT       NOT NULL AUTO_INCREMENT COMMENT '배정ID',
    schedule_id     BIGINT       NOT NULL COMMENT '스케줄ID(FK)',
    user_id         BIGINT       NOT NULL COMMENT '근무자(사용자ID FK)',
    work_date       DATE         NOT NULL COMMENT '근무일',
    planned_start   TIME         NOT NULL COMMENT '예정 출근 시각',
    planned_end     TIME         NOT NULL COMMENT '예정 퇴근 시각',
    is_modified     BOOLEAN      NOT NULL COMMENT '수정 여부',
    modified_by     BIGINT                COMMENT '수정자(사용자ID FK)',
    has_warning     BOOLEAN      NOT NULL COMMENT '경고 여부(재검증 결과)',
    PRIMARY KEY (assignment_id)
) COMMENT '근무 배정';

-- ---------------------------------------------------------------------
-- 근태·급여
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id   BIGINT       NOT NULL AUTO_INCREMENT COMMENT '출퇴근ID',
    user_id         BIGINT       NOT NULL COMMENT '사용자ID(FK)',
    assignment_id   BIGINT                COMMENT '배정ID(FK, 대타 근무면 비어 있음)',
    clock_in        DATETIME     NOT NULL COMMENT '출근 시각',
    clock_out       DATETIME              COMMENT '퇴근 시각',
    actual_hours    DECIMAL(5,2)          COMMENT '실 근무시간',
    status          VARCHAR(20)           COMMENT '근태 상태(정상·지각·조퇴)',
    PRIMARY KEY (attendance_id)
) COMMENT '출퇴근 기록';

CREATE TABLE payroll (
    payroll_id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '급여ID',
    user_id               BIGINT       NOT NULL COMMENT '사용자ID(FK)',
    period_start          DATE         NOT NULL COMMENT '정산 기간 시작(주)',
    period_end            DATE         NOT NULL COMMENT '정산 기간 종료(주)',
    total_hours           DECIMAL(5,2) NOT NULL COMMENT '총 근무시간',
    applied_wage          INT          NOT NULL COMMENT '적용 시급',
    base_pay              INT          NOT NULL COMMENT '기본 급여',
    is_holiday_pay_target BOOLEAN      NOT NULL COMMENT '주휴수당 해당 여부',
    holiday_pay           INT                   COMMENT '주휴수당',
    total_pay             INT          NOT NULL COMMENT '총 급여',
    calculated_at         DATETIME     NOT NULL COMMENT '계산 일시',
    PRIMARY KEY (payroll_id),
    UNIQUE KEY uk_payroll_user_period (user_id, period_start)
) COMMENT '급여 내역';

-- ---------------------------------------------------------------------
-- 재고
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
    inventory_id    BIGINT        NOT NULL AUTO_INCREMENT COMMENT '재고ID',
    ingredient_id   BIGINT        NOT NULL COMMENT '재료ID(FK, 재료와 1:1)',
    current_qty     DECIMAL(10,2) NOT NULL COMMENT '현재 수량',
    updated_at      DATETIME      NOT NULL COMMENT '최종 갱신 일시',
    is_short        BOOLEAN       NOT NULL COMMENT '부족 여부',
    PRIMARY KEY (inventory_id),
    UNIQUE KEY uk_inventory_ingredient (ingredient_id)
) COMMENT '재고 현황';

CREATE TABLE shortage_report (
    report_id       BIGINT       NOT NULL AUTO_INCREMENT COMMENT '신고ID',
    ingredient_id   BIGINT       NOT NULL COMMENT '재료ID(FK)',
    reporter_id     BIGINT       NOT NULL COMMENT '신고자(사용자ID FK)',
    shortage_level  VARCHAR(20)           COMMENT '부족 정도',
    memo            VARCHAR(255)          COMMENT '메모',
    reported_at     DATETIME     NOT NULL COMMENT '신고 일시',
    status          VARCHAR(20)  NOT NULL COMMENT '처리 상태',
    PRIMARY KEY (report_id)
) COMMENT '부족 신고';

CREATE TABLE notification (
    notification_id BIGINT       NOT NULL AUTO_INCREMENT COMMENT '알림ID',
    recipient_id    BIGINT       NOT NULL COMMENT '수신자(사용자ID FK)',
    report_id       BIGINT                COMMENT '신고ID(FK, 수동 신고일 때만)',
    type            VARCHAR(30)  NOT NULL COMMENT '알림 종류',
    source          VARCHAR(20)  NOT NULL COMMENT '발생 경로(자동 감지·수동 신고)',
    content         VARCHAR(500)          COMMENT '내용',
    sent_at         DATETIME     NOT NULL COMMENT '발송 일시',
    is_read         BOOLEAN      NOT NULL COMMENT '확인 여부',
    PRIMARY KEY (notification_id)
) COMMENT '알림 이력';

-- ---------------------------------------------------------------------
-- 예측 오차·보정 → 발주·입고 → 재고 변동 (FK 참조 순서대로 생성)
-- ---------------------------------------------------------------------
CREATE TABLE forecast_error (
    error_id        BIGINT        NOT NULL AUTO_INCREMENT COMMENT '오차ID',
    ingredient_id   BIGINT        NOT NULL COMMENT '재료ID(FK)',
    period_start    DATE          NOT NULL COMMENT '평가 기간 시작',
    period_end      DATE          NOT NULL COMMENT '평가 기간 종료',
    opening_stock   DECIMAL(10,2) NOT NULL COMMENT '기초 재고',
    closing_stock   DECIMAL(10,2) NOT NULL COMMENT '기말 재고',
    actual_usage    DECIMAL(10,2) NOT NULL COMMENT '실제 소진량',
    forecast_usage  DECIMAL(10,2) NOT NULL COMMENT '예측 소진량',
    error_qty       DECIMAL(10,2) NOT NULL COMMENT '오차량',
    error_rate      DECIMAL(6,2)  NOT NULL COMMENT '오차율(%)',
    waste_qty       DECIMAL(10,2)          COMMENT '폐기량',
    PRIMARY KEY (error_id)
) COMMENT '예측 오차 기록';

CREATE TABLE correction_coefficient (
    coefficient_id  BIGINT        NOT NULL AUTO_INCREMENT COMMENT '계수ID',
    ingredient_id   BIGINT        NOT NULL COMMENT '재료ID(FK)',
    error_id        BIGINT                 COMMENT '오차ID(FK, 첫 계수면 비어 있음)',
    previous_value  DECIMAL(6,3)           COMMENT '이전 계수',
    coefficient     DECIMAL(6,3)  NOT NULL COMMENT '보정 계수',
    qty_before      DECIMAL(10,2)          COMMENT '반영 전 권장량',
    qty_after       DECIMAL(10,2)          COMMENT '반영 후 권장량',
    effective_from  DATE          NOT NULL COMMENT '적용 시작일',
    applied_at      DATETIME      NOT NULL COMMENT '반영 일시',
    PRIMARY KEY (coefficient_id)
) COMMENT '보정 계수';

CREATE TABLE order_recommendation (
    recommendation_id BIGINT        NOT NULL AUTO_INCREMENT COMMENT '권장ID',
    ingredient_id     BIGINT        NOT NULL COMMENT '재료ID(FK)',
    coefficient_id    BIGINT                 COMMENT '적용 보정 계수ID(FK)',
    period_start      DATE          NOT NULL COMMENT '대상 기간 시작',
    period_end        DATE          NOT NULL COMMENT '대상 기간 종료',
    forecast_usage    DECIMAL(10,2) NOT NULL COMMENT '예측 소진량',
    stock_at_calc     DECIMAL(10,2) NOT NULL COMMENT '산출 시 재고',
    recommended_qty   DECIMAL(10,2) NOT NULL COMMENT '권장 수량(발주 단위)',
    estimated_cost    INT                    COMMENT '예상 금액',
    calculated_at     DATETIME      NOT NULL COMMENT '산출 일시',
    PRIMARY KEY (recommendation_id)
) COMMENT '권장 발주량';

CREATE TABLE purchase_order (
    order_id          BIGINT        NOT NULL AUTO_INCREMENT COMMENT '발주ID',
    ingredient_id     BIGINT        NOT NULL COMMENT '재료ID(FK)',
    recommendation_id BIGINT                 COMMENT '권장ID(FK, 권장량 없이 발주하면 비어 있음)',
    ordered_by        BIGINT        NOT NULL COMMENT '발주자(사용자ID FK)',
    order_qty         DECIMAL(10,2) NOT NULL COMMENT '발주 수량',
    is_adjusted       BOOLEAN       NOT NULL COMMENT '조정 여부',
    status            VARCHAR(20)   NOT NULL COMMENT '상태(대기·입고완료)',
    ordered_at        DATETIME      NOT NULL COMMENT '발주 일시',
    PRIMARY KEY (order_id)
) COMMENT '발주 기록';

CREATE TABLE receipt (
    receipt_id      BIGINT        NOT NULL AUTO_INCREMENT COMMENT '입고ID',
    order_id        BIGINT        NOT NULL COMMENT '발주ID(FK)',
    handled_by      BIGINT        NOT NULL COMMENT '처리자(사용자ID FK)',
    received_qty    DECIMAL(10,2) NOT NULL COMMENT '입고 수량',
    diff_qty        DECIMAL(10,2)          COMMENT '차이 수량',
    diff_reason     VARCHAR(255)           COMMENT '차이 사유',
    received_at     DATETIME      NOT NULL COMMENT '입고 일시',
    PRIMARY KEY (receipt_id)
) COMMENT '입고 기록';

CREATE TABLE inventory_change (
    change_id       BIGINT        NOT NULL AUTO_INCREMENT COMMENT '변동ID',
    ingredient_id   BIGINT        NOT NULL COMMENT '재료ID(FK)',
    change_type     VARCHAR(20)   NOT NULL COMMENT '변동 유형(판매 차감·입고·폐기·실사 보정)',
    sale_id         BIGINT                 COMMENT '판매ID(FK, 판매 차감일 때만)',
    receipt_id      BIGINT                 COMMENT '입고ID(FK, 입고일 때만)',
    change_qty      DECIMAL(10,2) NOT NULL COMMENT '변동 수량(+/-)',
    reason          VARCHAR(255)           COMMENT '사유',
    handled_by      BIGINT                 COMMENT '처리자(사용자ID FK)',
    changed_at      DATETIME      NOT NULL COMMENT '변동 일시',
    PRIMARY KEY (change_id)
) COMMENT '재고 변동 기록';

-- =====================================================================
-- 관계(FK) — 참조하는 쪽(N) → 참조되는 쪽(1)
-- =====================================================================
-- 매장 1:N
ALTER TABLE user_account     ADD CONSTRAINT fk_user_store        FOREIGN KEY (store_id)      REFERENCES store (store_id);
ALTER TABLE menu             ADD CONSTRAINT fk_menu_store        FOREIGN KEY (store_id)      REFERENCES store (store_id);
ALTER TABLE ingredient       ADD CONSTRAINT fk_ingredient_store  FOREIGN KEY (store_id)      REFERENCES store (store_id);
ALTER TABLE sales_summary    ADD CONSTRAINT fk_summary_store     FOREIGN KEY (store_id)      REFERENCES store (store_id);
ALTER TABLE sales_forecast   ADD CONSTRAINT fk_forecast_store    FOREIGN KEY (store_id)      REFERENCES store (store_id);
ALTER TABLE work_schedule    ADD CONSTRAINT fk_schedule_store    FOREIGN KEY (store_id)      REFERENCES store (store_id);

-- 메뉴·재료 1:N
ALTER TABLE recipe           ADD CONSTRAINT fk_recipe_menu       FOREIGN KEY (menu_id)       REFERENCES menu (menu_id);
ALTER TABLE recipe           ADD CONSTRAINT fk_recipe_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE sale             ADD CONSTRAINT fk_sale_menu         FOREIGN KEY (menu_id)       REFERENCES menu (menu_id);

-- 사용자 계정 1:N
ALTER TABLE availability     ADD CONSTRAINT fk_avail_user        FOREIGN KEY (user_id)       REFERENCES user_account (user_id);
ALTER TABLE work_schedule    ADD CONSTRAINT fk_schedule_confirmer FOREIGN KEY (confirmed_by) REFERENCES user_account (user_id);
ALTER TABLE shift_assignment ADD CONSTRAINT fk_assign_user       FOREIGN KEY (user_id)       REFERENCES user_account (user_id);
ALTER TABLE shift_assignment ADD CONSTRAINT fk_assign_modifier   FOREIGN KEY (modified_by)   REFERENCES user_account (user_id);
ALTER TABLE attendance       ADD CONSTRAINT fk_attend_user       FOREIGN KEY (user_id)       REFERENCES user_account (user_id);
ALTER TABLE payroll          ADD CONSTRAINT fk_payroll_user      FOREIGN KEY (user_id)       REFERENCES user_account (user_id);
ALTER TABLE shortage_report  ADD CONSTRAINT fk_report_user       FOREIGN KEY (reporter_id)   REFERENCES user_account (user_id);
ALTER TABLE notification     ADD CONSTRAINT fk_noti_user         FOREIGN KEY (recipient_id)  REFERENCES user_account (user_id);
ALTER TABLE purchase_order   ADD CONSTRAINT fk_order_user        FOREIGN KEY (ordered_by)    REFERENCES user_account (user_id);
ALTER TABLE receipt          ADD CONSTRAINT fk_receipt_user      FOREIGN KEY (handled_by)    REFERENCES user_account (user_id);
ALTER TABLE inventory_change ADD CONSTRAINT fk_change_user       FOREIGN KEY (handled_by)    REFERENCES user_account (user_id);

-- 스케줄 → 배정 → 출퇴근 1:N
ALTER TABLE shift_assignment ADD CONSTRAINT fk_assign_schedule   FOREIGN KEY (schedule_id)   REFERENCES work_schedule (schedule_id);
ALTER TABLE attendance       ADD CONSTRAINT fk_attend_assign     FOREIGN KEY (assignment_id) REFERENCES shift_assignment (assignment_id);

-- 재료 기준 재고·발주 (재고 현황만 1:1)
ALTER TABLE inventory        ADD CONSTRAINT fk_inventory_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE inventory_change ADD CONSTRAINT fk_change_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE shortage_report  ADD CONSTRAINT fk_report_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE forecast_error   ADD CONSTRAINT fk_error_ingredient  FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE correction_coefficient ADD CONSTRAINT fk_coef_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE order_recommendation   ADD CONSTRAINT fk_rec_ingredient  FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);
ALTER TABLE purchase_order   ADD CONSTRAINT fk_order_ingredient  FOREIGN KEY (ingredient_id) REFERENCES ingredient (ingredient_id);

-- 오차 → 보정 계수 → 권장 발주량 → 발주 → 입고 1:N
ALTER TABLE correction_coefficient ADD CONSTRAINT fk_coef_error  FOREIGN KEY (error_id)       REFERENCES forecast_error (error_id);
ALTER TABLE order_recommendation   ADD CONSTRAINT fk_rec_coef    FOREIGN KEY (coefficient_id) REFERENCES correction_coefficient (coefficient_id);
ALTER TABLE purchase_order   ADD CONSTRAINT fk_order_rec         FOREIGN KEY (recommendation_id) REFERENCES order_recommendation (recommendation_id);
ALTER TABLE receipt          ADD CONSTRAINT fk_receipt_order     FOREIGN KEY (order_id)      REFERENCES purchase_order (order_id);

-- 재고 변동의 원인(판매·입고) 1:N
ALTER TABLE inventory_change ADD CONSTRAINT fk_change_sale       FOREIGN KEY (sale_id)       REFERENCES sale (sale_id);
ALTER TABLE inventory_change ADD CONSTRAINT fk_change_receipt    FOREIGN KEY (receipt_id)    REFERENCES receipt (receipt_id);

-- 알림 ← 부족 신고 1:N
ALTER TABLE notification     ADD CONSTRAINT fk_noti_report       FOREIGN KEY (report_id)     REFERENCES shortage_report (report_id);
