/* 화면 간 공유 상태. 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   Supabase 가 연결돼 있으면 2-1 가능시간·2-3 스케줄 초안은 DB 함수로 읽고 저장하고, 없으면 예시 데이터로 동작한다. */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS, STORE, SHIFTS, ME_STAFF_ID, NEXT_WEEK_START, THIS_WEEK_START, staffById, staffByDbId } from '../mocks/data.js';
import { NEED, cellKey, generateDraft, rangesToAvail, rangesToSlots, slotsToRanges } from '../domain/index.js';
import { supabase } from '../lib/supabase.js';
import * as api from '../lib/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// work_schedule.status(DB) → 화면 단계
const SCHED_STATE = { 초안: 'draft', 검토중: 'review', 확정: 'published' };
const SHIFT_ARGS = SHIFTS.map(({ id, start, end }) => ({ id, start, end }));
const ME_DB_ID = staffById[ME_STAFF_ID].dbId; // TODO(0단계): 로그인 사용자로 교체

export function AppStateProvider({ children }) {
  // work_schedule.status: none | draft | review | published
  const [schedState, setSchedState] = useState('none');
  const [assign, setAssign] = useState({});
  const [need, setNeed] = useState(NEED); // 시프트별 필요 인원 (DB 연결 시 sales_forecast 기준)
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
  const [myMaxHours, setMyMaxHours] = useState(staffById[ME_STAFF_ID].maxHours);
  const [availSubmitted, setAvailSubmitted] = useState(false);

  const notify = (title) => setNotifications((p) => [{ id: `n${Date.now()}`, kind: 'system', title, at: '방금', read: false }, ...p]);

  // DB 가능시간(availability_of 결과)을 화면 직원 목록에 반영
  const mergeStaff = (rows) => {
    const byDb = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    setStaff((prev) => prev.map((st) => {
      const r = byDb[st.dbId];
      return r ? { ...st, maxHours: Number(r.max_weekly_hours ?? st.maxHours), avail: rangesToAvail(r.ranges) } : st;
    }));
  };

  const applyMyAvail = (r) => {
    if (r.ranges.length) setMyAvail(rangesToSlots(r.ranges));
    if (r.max_weekly_hours != null) setMyMaxHours(Number(r.max_weekly_hours));
    // availability 에는 주차가 없어서, 이번 주(월) 이후에 등록했으면 다음 주 분량을 제출한 것으로 본다
    setAvailSubmitted(!!r.registered_at && r.registered_at.slice(0, 10) >= THIS_WEEK_START);
    mergeStaff([r]);
  };

  const applySchedule = (res) => {
    if (!res) return;
    const nextAssign = {};
    const nextNeed = {};
    res.cells.forEach((c) => {
      const k = cellKey(c.day, c.shift);
      nextNeed[k] = c.need;
      nextAssign[k] = c.user_ids.map((uid) => staffByDbId[uid]?.id).filter(Boolean); // 화면에 없는 직원은 표시하지 않음(0단계 전 임시)
    });
    mergeStaff(res.staff);
    setNeed(nextNeed);
    setAssign(nextAssign);
    setSchedState(SCHED_STATE[res.status] || 'draft');
  };

  // 첫 화면: 내 가능시간 + 다음 주 스케줄 불러오기
  useEffect(() => {
    if (!supabase) return;
    api.fetchAvailability(ME_DB_ID).then((r) => r && applyMyAvail(r)).catch((e) => console.error('가능시간 조회 실패', e));
    api.fetchSchedule(STORE.dbId, NEXT_WEEK_START, SHIFT_ARGS).then(applySchedule).catch((e) => console.error('스케줄 조회 실패', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2-1 · 가능시간 제출 (실패하면 throw → 화면이 오류 표시)
  const submitMyAvail = async (maxHours) => {
    if (supabase) applyMyAvail(await api.saveAvailability(ME_DB_ID, slotsToRanges(myAvail), maxHours));
    else { setMyMaxHours(maxHours); setAvailSubmitted(true); }
  };

  // 2-3 · 스케줄 초안 자동 생성 (실패하면 throw)
  const generateSchedule = async () => {
    if (supabase) { applySchedule(await api.generateScheduleDraft(STORE.dbId, NEXT_WEEK_START, SHIFT_ARGS)); return; }
    await new Promise((r) => setTimeout(r, 900));
    setNeed(NEED); setAssign(generateDraft()); setSchedState('draft');
  };

  const lowStock = useMemo(() => inventory.filter((i) => i.stock < i.min), [inventory]);
  const unread = notifications.filter((n) => !n.read).length;

  const value = {
    schedState, setSchedState, assign, setAssign, need, edited, setEdited, generateSchedule,
    inventory, setInventory, lowStock, orders, setOrders,
    reports, setReports, notifications, setNotifications, unread, notify,
    staff, setStaff, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, myMaxHours, availSubmitted, submitMyAvail,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
