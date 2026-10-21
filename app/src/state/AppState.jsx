/* 화면 간 공유 상태 (예시 데이터 기반). 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   DB 연동 단계에서는 이 Provider 내부만 Supabase 조회·저장으로 바꾼다. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS, NEXT_WEEK_START } from '../mocks/data.js';
import { warningCells } from '../domain/index.js';
import { supabase } from '../lib/supabase.js';
import { fetchSchedule, saveCell, saveDraft, setScheduleState, syncWarnings } from '../lib/scheduleRepo.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppStateProvider({ children }) {
  // work_schedule.status: none | draft | review | published
  const [schedState, setSchedState] = useState('none');
  const [assign, setAssign] = useState({});
  const [edited, setEdited] = useState([]);
  const scheduleId = useRef(null); // work_schedule.schedule_id (DB 연결 시). 저장 대기열 안에서 최신 값을 읽도록 ref
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

  // 2-3 ~ 2-6 · 다음 주 스케줄을 DB에서 읽는다. 환경변수가 없으면 예시 데이터(빈 상태)로 동작한다.
  const reloadSchedule = useCallback(async () => {
    if (!supabase) return;
    const sch = await fetchSchedule(NEXT_WEEK_START);
    scheduleId.current = sch?.id ?? null;
    setSchedState(sch?.state ?? 'none');
    setAssign(sch?.assign ?? {});
    setEdited(sch?.edited ?? []);
  }, []);
  useEffect(() => { reloadSchedule().catch((e) => console.error('스케줄 조회 실패', e)); }, [reloadSchedule]);

  // 저장은 순서대로 한 줄로 처리한다(수정 직후 확정해도 순서가 꼬이지 않게). 실패하면 DB 값으로 되돌린다.
  const queue = useRef(Promise.resolve());
  const persist = (fn) => {
    if (!supabase) return Promise.resolve();
    const run = queue.current.then(fn);
    queue.current = run.catch(() => {});
    return run.catch(async (e) => { await reloadSchedule().catch(() => {}); throw e; });
  };

  // 2-3 · 초안 생성 결과 저장
  const saveScheduleDraft = (next) => {
    setAssign(next); setEdited([]); setSchedState('draft');
    return persist(async () => { scheduleId.current = await saveDraft(NEXT_WEEK_START, next); });
  };
  // 2-4 · 칸 수정 + E4 재검증(has_warning 갱신). byUserId = 수정한 사람
  const editScheduleCell = (k, ids, byUserId) => {
    const next = { ...assign, [k]: ids };
    setAssign(next); setEdited((x) => [...new Set([...x, k])]);
    return persist(async () => {
      await saveCell(scheduleId.current, NEXT_WEEK_START, k, ids, byUserId);
      await syncWarnings(scheduleId.current, NEXT_WEEK_START, warningCells(next));
    });
  };
  // 2-4 검토 요청·완료 / 2-5 확정·공개 / 다시 편집. 알림은 DB 트리거가 기록한다.
  const changeScheduleState = (state, byUserId) => {
    setSchedState(state);
    return persist(() => setScheduleState(scheduleId.current, state, byUserId));
  };

  const notify = (title) => setNotifications((p) => [{ id: `n${Date.now()}`, kind: 'system', title, at: '방금', read: false }, ...p]);

  const lowStock = useMemo(() => inventory.filter((i) => i.stock < i.min), [inventory]);
  const unread = notifications.filter((n) => !n.read).length;

  const value = {
    schedState, setSchedState, assign, setAssign, edited, setEdited,
    saveScheduleDraft, editScheduleCell, changeScheduleState,
    inventory, setInventory, lowStock, orders, setOrders,
    reports, setReports, notifications, setNotifications, unread, notify,
    staff, setStaff, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, availSubmitted, setAvailSubmitted,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
