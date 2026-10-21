/* 화면 간 공유 상태. 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   Supabase 가 연결돼 있으면 2-1 가능시간·2-3 스케줄 초안은 DB 함수(api.js)로, 2-4~2-6 검토·수정·확정은 scheduleRepo.js 로
   읽고 저장하고, 없으면 예시 데이터로 동작한다. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS, STORE, SHIFTS, ME_STAFF_ID, NEXT_WEEK_START, THIS_WEEK_START, staffById, staffByDbId } from '../mocks/data.js';
import { NEED, cellKey, generateDraft, rangesToAvail, rangesToSlots, slotsToRanges, warningCells } from '../domain/index.js';
import { supabase } from '../lib/supabase.js';
import * as api from '../lib/api.js';
import { fetchSchedule as fetchScheduleRows, saveCell, setScheduleState, syncWarnings } from '../lib/scheduleRepo.js';

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

  // get_schedule 결과(없으면 null)를 화면 상태로 옮긴다. 스케줄이 없으면 '없음'으로 되돌린다.
  const applySchedule = (res) => {
    if (!res) {
      scheduleId.current = null;
      setSchedState('none'); setAssign({}); setEdited([]);
      return;
    }
    const nextAssign = {};
    const nextNeed = {};
    res.cells.forEach((c) => {
      const k = cellKey(c.day, c.shift);
      nextNeed[k] = c.need;
      nextAssign[k] = c.user_ids.map((uid) => staffByDbId[uid]?.id).filter(Boolean); // 화면에 없는 직원은 표시하지 않음(0단계 전 임시)
    });
    scheduleId.current = res.schedule_id;
    mergeStaff(res.staff);
    setNeed(nextNeed);
    setAssign(nextAssign);
    setSchedState(SCHED_STATE[res.status] || 'draft');
  };

  // 2-3 ~ 2-6 · 다음 주 스케줄을 DB에서 읽는다. 환경변수가 없으면 예시 데이터(빈 상태)로 동작한다.
  // '수정됨' 표시(is_modified)는 get_schedule 결과에 없어서 배정 행에서 따로 읽는다.
  const reloadSchedule = useCallback(async () => {
    if (!supabase) return;
    applySchedule(await api.fetchSchedule(STORE.dbId, NEXT_WEEK_START, SHIFT_ARGS));
    const rows = await fetchScheduleRows(NEXT_WEEK_START);
    setEdited(rows?.edited ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 첫 화면: 내 가능시간 + 다음 주 스케줄 불러오기
  useEffect(() => {
    if (!supabase) return;
    api.fetchAvailability(ME_DB_ID).then((r) => r && applyMyAvail(r)).catch((e) => console.error('가능시간 조회 실패', e));
    reloadSchedule().catch((e) => console.error('스케줄 조회 실패', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장은 순서대로 한 줄로 처리한다(수정 직후 확정해도 순서가 꼬이지 않게). 실패하면 DB 값으로 되돌린다.
  const queue = useRef(Promise.resolve());
  const persist = (fn) => {
    if (!supabase) return Promise.resolve();
    const run = queue.current.then(fn);
    queue.current = run.catch(() => {});
    return run.catch(async (e) => { await reloadSchedule().catch(() => {}); throw e; });
  };

  // 2-1 · 가능시간 제출 (실패하면 throw → 화면이 오류 표시)
  const submitMyAvail = async (maxHours) => {
    if (supabase) applyMyAvail(await api.saveAvailability(ME_DB_ID, slotsToRanges(myAvail), maxHours));
    else { setMyMaxHours(maxHours); setAvailSubmitted(true); }
  };

  // 2-3 · 스케줄 초안 자동 생성 (DB 함수가 생성·저장까지 처리한다. 실패하면 throw)
  const generateSchedule = async () => {
    if (supabase) {
      applySchedule(await api.generateScheduleDraft(STORE.dbId, NEXT_WEEK_START, SHIFT_ARGS));
      setEdited([]);
      return;
    }
    await new Promise((r) => setTimeout(r, 900));
    setNeed(NEED); setAssign(generateDraft()); setEdited([]); setSchedState('draft');
  };

  // 2-4 · 칸 수정 + E4 재검증(has_warning 갱신). byUserId = 수정한 사람
  const editScheduleCell = (k, ids, byUserId) => {
    const next = { ...assign, [k]: ids };
    setAssign(next); setEdited((x) => [...new Set([...x, k])]);
    return persist(async () => {
      await saveCell(scheduleId.current, NEXT_WEEK_START, k, ids, byUserId);
      await syncWarnings(scheduleId.current, NEXT_WEEK_START, warningCells(next, staff));
    });
  };

  // 2-4 검토 요청·완료 / 2-5 확정·공개 / 다시 편집. 알림은 DB 트리거가 기록한다.
  const changeScheduleState = (state, byUserId) => {
    setSchedState(state);
    return persist(() => setScheduleState(scheduleId.current, state, byUserId));
  };

  const lowStock = useMemo(() => inventory.filter((i) => i.stock < i.min), [inventory]);
  const unread = notifications.filter((n) => !n.read).length;

  const value = {
    schedState, setSchedState, assign, setAssign, need, edited, setEdited,
    generateSchedule, editScheduleCell, changeScheduleState,
    inventory, setInventory, lowStock, orders, setOrders,
    reports, setReports, notifications, setNotifications, unread, notify,
    staff, setStaff, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, myMaxHours, availSubmitted, submitMyAvail,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
