/* 화면 간 공유 상태 (예시 데이터 기반). 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   DB 연동 단계에서는 이 Provider 내부만 Supabase 조회·저장으로 바꾼다. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS } from '../mocks/data.js';
import { fetchInventory } from '../lib/inventory.js';
import { fetchReports, fetchNotifications } from '../lib/alerts.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppStateProvider({ children }) {
  // work_schedule.status: none | draft | review | published
  const [schedState, setSchedState] = useState('none');
  const [assign, setAssign] = useState({});
  const [edited, setEdited] = useState([]);
  const [inventory, setInventory] = useState(INGREDIENTS);
  const [inventorySource, setInventorySource] = useState('sample'); // 'db' | 'sample'
  // 4-2·4-4·4-5: DB에서 읽고, 실패하면 예시 데이터를 유지한다. 쓰기 뒤에는 reload* 로 다시 읽는다.
  const reloadInventory = useCallback(() => fetchInventory()
    .then((rows) => { setInventory(rows); setInventorySource('db'); })
    .catch((e) => console.warn('재고 조회 실패, 예시 데이터 사용:', e.message)), []);
  useEffect(() => { reloadInventory(); }, [reloadInventory]);
  const [orders, setOrders] = useState(ORDERS);
  const [reports, setReports] = useState(SHORTAGE_REPORTS);
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
  const reloadReports = useCallback(() => fetchReports()
    .then(setReports)
    .catch((e) => console.warn('신고 조회 실패, 예시 데이터 사용:', e.message)), []);
  useEffect(() => { reloadReports(); }, [reloadReports]);
  // 알림은 받는 사람(점주·매니저)별이라 레이아웃이 현재 사용자로 불러온다.
  const alertUser = useRef(null);
  const loadAlerts = useCallback((userId) => {
    if (userId != null) alertUser.current = userId;
    if (alertUser.current == null) return Promise.resolve();
    return fetchNotifications(alertUser.current)
      .then(setNotifications)
      .catch((e) => console.warn('알림 조회 실패, 예시 데이터 사용:', e.message));
  }, []);
  const [staff, setStaff] = useState(STAFF);
  const [menus, setMenus] = useState(MENUS);
  const [clock, setClock] = useState({ in: null, out: null }); // 오늘 정윤수 출퇴근
  const [myAvail, setMyAvail] = useState(() => {
    // 정윤수 다음 주 가능시간: 요일 × [오전, 오후, 저녁]
    const base = { 0: [0, 0, 1], 1: [0, 0, 1], 2: [0, 0, 1], 3: [0, 0, 1], 4: [0, 0, 1], 5: [0, 1, 1], 6: [0, 1, 1] };
    return base;
  });
  const [availSubmitted, setAvailSubmitted] = useState(false);

  const notify = (title) => setNotifications((p) => [{ id: `n${Date.now()}`, kind: 'system', title, at: '방금', read: false }, ...p]);

  const lowStock = useMemo(() => inventory.filter((i) => i.stock < i.min), [inventory]);
  const unread = notifications.filter((n) => !n.read).length;

  const value = {
    schedState, setSchedState, assign, setAssign, edited, setEdited,
    inventory, setInventory, inventorySource, lowStock, orders, setOrders,
    reports, setReports, reloadInventory, reloadReports, loadAlerts, notifications, setNotifications, unread, notify,
    staff, setStaff, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, availSubmitted, setAvailSubmitted,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
