/* 화면 간 공유 상태 (예시 데이터 기반). 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   DB 연동 단계에서는 이 Provider 내부만 Supabase 조회·저장으로 바꾼다. */
import { createContext, useContext, useMemo, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS } from '../mocks/data.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppStateProvider({ children }) {
  // work_schedule.status: none | draft | review | published
  const [schedState, setSchedState] = useState('none');
  const [assign, setAssign] = useState({});
  const [edited, setEdited] = useState([]);
  const [inventory, setInventory] = useState(INGREDIENTS);
  const [orders, setOrders] = useState(ORDERS);
  const [reports, setReports] = useState(SHORTAGE_REPORTS);
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
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
    inventory, setInventory, lowStock, orders, setOrders,
    reports, setReports, notifications, setNotifications, unread, notify,
    staff, setStaff, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, availSubmitted, setAvailSubmitted,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
