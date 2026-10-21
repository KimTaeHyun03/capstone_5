/* 예시 데이터 — DB 연동 전 화면 확인용. 이름은 22개 테이블(snake_case) 대응을 주석으로 남긴다.
   기준일: 2026-10-21(수). '이번 주' = 10.19–10.25, '다음 주' = 10.26–11.01 */

export const TODAY = { label: '10.21(수)', dayIndex: 2, time: '08:52' };

export const STORE = { // store
  name: '카페 온기', address: '서울 성동구 성수이로 12', open: 8, close: 22, phone: '02-555-0142',
};

export const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
export const THIS_DATES = ['10.19', '10.20', '10.21', '10.22', '10.23', '10.24', '10.25'];
export const NEXT_DATES = ['10.26', '10.27', '10.28', '10.29', '10.30', '10.31', '11.01'];
export const NEXT_RANGE = '10.26(월) – 11.01(일)';
export const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

const HOUR_PROFILE = { 8: 0.62, 9: 0.92, 10: 0.7, 11: 0.82, 12: 1.32, 13: 1.4, 14: 1.0, 15: 1.08, 16: 0.98, 17: 0.86, 18: 0.78, 19: 0.66, 20: 0.48, 21: 0.3 };
const DAY_FACTOR = [0.8, 0.78, 0.86, 0.9, 1.06, 1.42, 1.3];

// sales_summary — 지난주 요일·시간대별 매출 (천원)
export const LAST_WEEK = DAYS.map((_, di) =>
  HOURS.map((h) => Math.round(60 * HOUR_PROFILE[h] * DAY_FACTOR[di] + (((di * 7 + h * 13) % 9) - 4)))
);
// 4주 전 평균 (천원) — 매출 현황 비교용
export const AVG_4W = LAST_WEEK.map((row, di) => row.map((v, hi) => Math.round(v * (0.94 + (((di * 3 + hi) % 5) - 2) * 0.015))));
// sales_forecast — 다음 주 예측 (천원)
export const FORECAST = LAST_WEEK.map((row, di) => row.map((v, hi) => Math.round(v * (1.03 + (((di + hi) % 3) - 1) * 0.02))));

// menu
export const MENUS = [
  { id: 'm1', name: '아메리카노', category: '커피', price: 4500, onSale: true, sold: 612 },
  { id: 'm2', name: '카페라떼', category: '커피', price: 5000, onSale: true, sold: 438 },
  { id: 'm3', name: '바닐라라떼', category: '커피', price: 5500, onSale: true, sold: 251 },
  { id: 'm4', name: '카페모카', category: '커피', price: 5500, onSale: true, sold: 118 },
  { id: 'm5', name: '레몬에이드', category: '음료', price: 5500, onSale: true, sold: 96 },
  { id: 'm6', name: '크루아상', category: '베이커리', price: 3800, onSale: true, sold: 174 },
  { id: 'm7', name: '시즌 단호박 라떼', category: '시즌', price: 6000, onSale: false, sold: 0 },
];

// ingredient + inventory + order_recommendation(+correction_coefficient)
export const INGREDIENTS = [
  { id: 'i1', name: '원두', unit: 'kg', price: 28000, min: 5, orderUnit: 1, stock: 4, use: 14, factor: 0.95, supplier: '빈하우스' },
  { id: 'i2', name: '우유', unit: 'L', price: 2400, min: 20, orderUnit: 12, stock: 18, use: 96, factor: 1.02, supplier: '서울우유 대리점' },
  { id: 'i3', name: '바닐라 시럽', unit: '병', price: 11000, min: 2, orderUnit: 1, stock: 3, use: 4, factor: 1.0, supplier: '카페재료몰' },
  { id: 'i4', name: '생크림', unit: 'L', price: 7800, min: 3, orderUnit: 1, stock: 2, use: 6, factor: 0.9, supplier: '서울우유 대리점' },
  { id: 'i5', name: '크루아상 생지', unit: '개', price: 900, min: 30, orderUnit: 20, stock: 42, use: 140, factor: 0.88, supplier: '베이크원' },
  { id: 'i6', name: '컵 12oz', unit: '개', price: 60, min: 200, orderUnit: 500, stock: 650, use: 900, factor: 1.0, supplier: '카페재료몰' },
  { id: 'i7', name: '초코 소스', unit: '병', price: 9500, min: 2, orderUnit: 1, stock: 5, use: 3, factor: 1.0, supplier: '카페재료몰' },
  { id: 'i8', name: '레몬', unit: '개', price: 500, min: 20, orderUnit: 10, stock: 12, use: 45, factor: 0.92, supplier: '청과마루' },
];

// recipe — 메뉴 1개당 재료 소요량
export const RECIPES = {
  m1: [['i1', 0.02], ['i6', 1]],
  m2: [['i1', 0.02], ['i2', 0.2], ['i6', 1]],
  m3: [['i1', 0.02], ['i2', 0.2], ['i3', 0.03], ['i6', 1]],
  m4: [['i1', 0.02], ['i2', 0.18], ['i7', 0.03], ['i4', 0.02], ['i6', 1]],
  m5: [['i8', 1.5], ['i6', 1]],
  m6: [['i5', 1]],
  m7: [],
};

export const SHIFTS = [
  { id: 'am', label: '오전', start: 8, end: 12 },
  { id: 'mid', label: '오후', start: 12, end: 17 },
  { id: 'pm', label: '저녁', start: 17, end: 22 },
];

// user_account + availability
export const OWNER = { id: 'o1', name: '김찬영', role: '점주', email: 'owner@cafe-ongi.kr' };
export const STAFF = [
  { id: 's1', name: '장윤서', role: '매니저', wage: 12500, maxHours: 30, status: '활성', phone: '010-2***-1842', avail: { 0: [8, 14], 1: [8, 14], 2: [8, 14], 3: [8, 14], 4: [8, 14] } },
  { id: 's2', name: '정윤수', role: '알바생', wage: 10320, maxHours: 20, status: '활성', phone: '010-5***-0931', avail: { 0: [17, 22], 1: [17, 22], 2: [17, 22], 3: [17, 22], 4: [17, 22], 5: [12, 22], 6: [12, 22] } },
  { id: 's3', name: '박서진', role: '알바생', wage: 10320, maxHours: 20, status: '활성', phone: '010-7***-2210', avail: { 0: [10, 17], 2: [10, 17], 4: [10, 17], 5: [8, 17] } },
  { id: 's4', name: '이도현', role: '알바생', wage: 10500, maxHours: 20, status: '활성', phone: '010-3***-5523', avail: { 1: [8, 17], 3: [8, 17], 6: [8, 17] } },
  { id: 's5', name: '최하은', role: '알바생', wage: 10320, maxHours: 16, status: '활성', phone: '010-9***-7781', avail: { 2: [14, 22], 5: [12, 22], 6: [14, 22] } },
  { id: 's6', name: '한지우', role: '알바생', wage: 10320, maxHours: 24, status: '초대됨', phone: '010-4***-3367', avail: { 1: [12, 22], 3: [12, 22], 5: [8, 17], 6: [8, 17] } },
];
export const staffById = Object.fromEntries(STAFF.map((s) => [s.id, s]));
export const ME_STAFF_ID = 's2'; // 알바생 화면의 로그인 사용자(정윤수)

// attendance — 이번 주 출퇴근 (예정 vs 실제, 시:분)
export const ATTENDANCE = [
  { id: 'a1', staffId: 's1', day: 0, plan: ['08:00', '12:00'], actual: ['07:56', '12:03'] },
  { id: 'a2', staffId: 's3', day: 0, plan: ['12:00', '17:00'], actual: ['12:07', '17:00'] },
  { id: 'a3', staffId: 's2', day: 0, plan: ['17:00', '22:00'], actual: ['16:55', '22:02'] },
  { id: 'a4', staffId: 's4', day: 1, plan: ['08:00', '12:00'], actual: ['08:00', '12:00'] },
  { id: 'a5', staffId: 's6', day: 1, plan: ['12:00', '17:00'], actual: ['12:00', '16:30'] },
  { id: 'a6', staffId: 's2', day: 1, plan: ['17:00', '22:00'], actual: ['17:12', '22:00'] },
  { id: 'a7', staffId: 's1', day: 2, plan: ['08:00', '12:00'], actual: ['07:58', null] },
];

// payroll — 이번 달(10월) 누적
export const PAYROLL = [
  { staffId: 's1', planHours: 96, actualHours: 95.5, month: '10월' },
  { staffId: 's2', planHours: 60, actualHours: 61, month: '10월' },
  { staffId: 's3', planHours: 45, actualHours: 44.5, month: '10월' },
  { staffId: 's4', planHours: 48, actualHours: 48, month: '10월' },
  { staffId: 's5', planHours: 30, actualHours: 26, month: '10월' },
  { staffId: 's6', planHours: 36, actualHours: 35.5, month: '10월' },
];
// 정윤수 근무 내역 (알바생 급여 화면)
export const MY_SHIFTS_DONE = [
  { date: '10.05(월)', start: '17:00', end: '22:00', hours: 5, flag: null },
  { date: '10.06(화)', start: '17:00', end: '22:00', hours: 5, flag: null },
  { date: '10.11(일)', start: '12:00', end: '22:00', hours: 10, flag: null },
  { date: '10.12(월)', start: '17:05', end: '22:00', hours: 4.9, flag: '지각 5분' },
  { date: '10.13(화)', start: '17:00', end: '22:00', hours: 5, flag: null },
  { date: '10.18(일)', start: '12:00', end: '22:00', hours: 10, flag: null },
  { date: '10.19(월)', start: '16:55', end: '22:02', hours: 5, flag: null },
  { date: '10.20(화)', start: '17:12', end: '22:00', hours: 4.8, flag: '지각 12분' },
];

// purchase_order + receipt
export const ORDERS = [
  { id: 'PO-1017', date: '10.17(토)', status: '입고완료', lines: [{ id: 'i2', qty: 96 }, { id: 'i5', qty: 140 }, { id: 'i8', qty: 40 }] },
  { id: 'PO-1020', date: '10.20(화)', status: '대기', lines: [{ id: 'i1', qty: 10 }, { id: 'i4', qty: 4 }, { id: 'i6', qty: 500 }] },
];

// shortage_report + notification
export const SHORTAGE_REPORTS = [
  { id: 'r1', ingredientId: 'i2', by: '장윤서', at: '오늘 07:42', note: '오전 라떼 주문 많아 2팩 남음' },
];
export const NOTIFICATIONS = [
  { id: 'n1', kind: 'stock', title: '원두 재고가 최소 보유량 아래로 내려갔습니다', at: '오늘 08:10', read: false },
  { id: 'n2', kind: 'report', title: '장윤서 님이 우유 부족을 신고했습니다', at: '오늘 07:42', read: false },
  { id: 'n3', kind: 'forecast', title: '다음 주 토요일 피크 매출이 지난주보다 9% 높게 예측됐습니다', at: '어제 23:00', read: false },
  { id: 'n4', kind: 'order', title: 'PO-1017 입고가 완료되어 재고에 반영됐습니다', at: '10.17(토) 15:20', read: true },
];

// forecast_error — 최근 4주 재료별 예측 오차
export const FORECAST_ERRORS = [
  { period: '9.28–10.04', rows: { i1: [13.5, 12.6, 0.2], i2: [92, 95, 1.5], i4: [6, 5.1, 0.6], i5: [150, 128, 14], i8: [45, 40, 3] } },
  { period: '10.05–10.11', rows: { i1: [14, 13.1, 0.1], i2: [94, 96, 0], i4: [6, 5.4, 0.4], i5: [145, 130, 11], i8: [44, 41, 2] } },
  { period: '10.12–10.18', rows: { i1: [14, 13.4, 0.1], i2: [95, 97, 1], i4: [6, 5.3, 0.5], i5: [140, 122, 12], i8: [46, 42, 3] } },
];
// [예측 소진, 실제 소진, 폐기]
