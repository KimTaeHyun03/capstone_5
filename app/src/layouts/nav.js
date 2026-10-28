// 역할별 메뉴 — 프로세스 목록 번호 기준. path 는 역할 루트(#/owner, #/manager) 기준 상대 경로
export const OWNER_NAV = [
  { id: 'home', label: '홈', icon: 'dashboard', items: [{ path: '', label: '대시보드' }] },
  { id: 'sales', label: '매출 분석', icon: 'chart', items: [
    { path: 'sales/records', label: '판매 기록', proc: '1-1' },
    { path: 'sales/status', label: '매출 현황', proc: '1-2' },
    { path: 'sales/forecast', label: '매출 예측', proc: '1-3' },
    { path: 'sales/events', label: '주변 행사', proc: '1-3 · E4' },
  ] },
  { id: 'work', label: '근무 관리', icon: 'calendar', items: [
    { path: 'work/availability', label: '가능시간 현황', proc: '2-2' },
    { path: 'work/timetable', label: '근무표 조회', proc: '2-6' },
    { path: 'work/schedule', label: '스케줄 편성', proc: '2-3 · 2-5' },
    { path: 'work/labor', label: '출퇴근·인건비', proc: '3-3' },
  ] },
  { id: 'stock', label: '재고 관리', icon: 'box', items: [
    { path: 'stock/inventory', label: '재고 현황', proc: '4-2' },
    { path: 'stock/stocktake', label: '실사·폐기 기록', proc: '4-3' },
    { path: 'stock/alerts', label: '부족 알림', proc: '4-5', badge: 'alerts' },
  ] },
  { id: 'order', label: '발주 관리', icon: 'truck', items: [
    { path: 'order/recommend', label: '권장 발주', proc: '5-1 · 5-2' },
    { path: 'order/orders', label: '발주·입고 내역', proc: '5-2 · 5-3' },
    { path: 'order/receive', label: '입고 처리', proc: '5-3' },
    { path: 'order/correction', label: '예측 오차 보정', proc: '6-1 · 6-2' },
  ] },
  { id: 'base', label: '기초 정보', icon: 'settings', items: [
    { path: 'base/store', label: '매장·직원', proc: '7-1' },
    { path: 'base/menu', label: '메뉴·레시피', proc: '7-2 · 7-4' },
    { path: 'base/ingredient', label: '재료', proc: '7-3' },
  ] },
];

export const MANAGER_NAV = [
  { id: 'home', label: '홈', icon: 'dashboard', items: [{ path: '', label: '오늘 할 일' }] },
  { id: 'work', label: '근무 관리', icon: 'calendar', items: [
    { path: 'my-availability', label: '내 가능시간 등록', proc: '2-1' },
    { path: 'availability', label: '가능시간 현황', proc: '2-2' },
    { path: 'timetable', label: '근무표 조회', proc: '2-6' },
    { path: 'schedule', label: '초안 검토·수정', proc: '2-4' },
    { path: 'clock', label: '출퇴근 기록', proc: '3-1' },
    { path: 'pay', label: '내 급여', proc: '3-2' },
  ] },
  { id: 'stock', label: '재고 관리', icon: 'box', items: [
    { path: 'inventory', label: '재고 현황', proc: '4-2' },
    { path: 'stocktake', label: '실사·폐기 기록', proc: '4-3' },
    { path: 'alerts', label: '부족 알림', proc: '4-5', badge: 'alerts' },
  ] },
  { id: 'order', label: '입고', icon: 'truck', items: [
    { path: 'receive', label: '입고 처리', proc: '5-3' },
  ] },
];

export const STAFF_TABS = [
  { path: '', label: '근무표', icon: 'calendar' },
  { path: 'availability', label: '가능시간', icon: 'clock' },
  { path: 'clock', label: '출퇴근', icon: 'target' },
  { path: 'pay', label: '급여', icon: 'wallet' },
  { path: 'report', label: '부족 신고', icon: 'flag' },
];
