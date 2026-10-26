/* 화면 간 공유 상태. 역할이 달라도 같은 매장 데이터를 보므로 하나로 둔다.
   Supabase 가 연결돼 있으면 DB 에서 읽고 저장하고, 없으면 예시 데이터로 동작한다.
   - 스케줄: 2-1 가능시간·2-3 초안은 DB 함수(api.js), 2-4~2-6 검토·수정·확정은 scheduleRepo.js
   - 재고·발주·오차 보정·알림: lib/inventory.js · orders.js · correction.js · alerts.js (쓰기 뒤에는 reload* 로 다시 읽는다) */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INGREDIENTS, ORDERS, SHORTAGE_REPORTS, NOTIFICATIONS, STAFF, MENUS, SHIFTS, ME_STAFF_ID, NEXT_WEEK_START, THIS_WEEK_START, staffById, staffByDbId, registerStaff, clearStaffRegistry, restoreMockStaffRegistry } from '../mocks/data.js';
import { NEED, cellKey, generateDraft, rangesToAvail, rangesToSlots, slotsToRanges, warningCells } from '../domain/index.js';
import { supabase } from '../lib/supabase.js';
import * as api from '../lib/api.js';
import { fetchSchedule as fetchScheduleRows, saveCell, setScheduleState, syncWarnings } from '../lib/scheduleRepo.js';
import { fetchInventory } from '../lib/inventory.js';
import { fetchReports, fetchNotifications } from '../lib/alerts.js';
import { fetchOrders, fetchRecommendations } from '../lib/orders.js';
import { fetchCorrection } from '../lib/correction.js';
import { useOperations } from './useOperations.js';
import { useAuth } from '../lib/auth.jsx';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// work_schedule.status(DB) → 화면 단계
const SCHED_STATE = { 초안: 'draft', 검토중: 'review', 확정: 'published' };
const SHIFT_ARGS = SHIFTS.map(({ id, start, end }) => ({ id, start, end }));

export function AppStateProvider({ children }) {
  const ops = useOperations();
  // 로그인한 사용자(DB 사용자 id). 체험 로그인이거나 로그인 전이면 null — 이때는 DB 를 읽지 않고 예시 데이터를 쓴다.
  const { account, demo } = useAuth();
  const dbUserId = account && !demo ? account.id : null;
  const storeId = account && !demo ? account.storeId : null; // 로그인한 사용자의 매장(DB store_id)
  const live = !!(supabase && dbUserId);
  // 사용자가 바뀐 뒤에 도착한 이전 사용자의 응답은 버린다.
  const epoch = useRef(0);
  const guard = (fn) => { const e = epoch.current; return (v) => { if (e === epoch.current) fn(v); }; };
  // work_schedule.status: none | draft | review | published
  const [schedState, setSchedState] = useState('none');
  const [assign, setAssign] = useState({});
  const [need, setNeed] = useState(NEED); // 시프트별 필요 인원 (DB 연결 시 sales_forecast 기준)
  const [edited, setEdited] = useState([]);
  const scheduleId = useRef(null); // work_schedule.schedule_id (DB 연결 시). 저장 대기열 안에서 최신 값을 읽도록 ref
  const [inventory, setInventory] = useState(INGREDIENTS);
  const [inventorySource, setInventorySource] = useState('sample'); // 'db' | 'sample'
  // 4-2·4-4·4-5: DB에서 읽고, 실패하면 예시 데이터를 유지한다. 쓰기 뒤에는 reload* 로 다시 읽는다.
  const reloadInventory = useCallback(() => fetchInventory()
    .then(guard((rows) => { setInventory(rows); setInventorySource('db'); }))
    .catch((e) => console.warn('재고 조회 실패, 예시 데이터 사용:', e.message)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [orders, setOrders] = useState(ORDERS);
  const reloadOrders = useCallback(() => fetchOrders()
    .then(guard(setOrders))
    .catch((e) => console.warn('발주 조회 실패, 예시 데이터 사용:', e.message)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [correction, setCorrection] = useState(null); // 6-1·6-2: { errors, coefs }. null 이면 화면이 예시 데이터를 쓴다.
  const reloadCorrection = useCallback(() => fetchCorrection()
    .then(guard((c) => setCorrection(c.errors.length ? c : null)))
    .catch((e) => console.warn('오차 리포트 조회 실패, 예시 데이터 사용:', e.message)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [recs, setRecs] = useState({}); // 재료별 최신 권장 발주량(5-1). 비어 있으면 화면이 예시 계산을 쓴다.
  const [recsLoaded, setRecsLoaded] = useState(false);
  const reloadRecs = useCallback(() => fetchRecommendations()
    .then(guard((r) => { setRecs(r); setRecsLoaded(true); }))
    .catch((e) => console.warn('권장 발주량 조회 실패, 예시 계산 사용:', e.message)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [reports, setReports] = useState(SHORTAGE_REPORTS);
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
  const reloadReports = useCallback(() => fetchReports()
    .then(guard(setReports))
    .catch((e) => console.warn('신고 조회 실패, 예시 데이터 사용:', e.message)), []); // eslint-disable-line react-hooks/exhaustive-deps
  // 알림은 받는 사람(점주·매니저)별이라 레이아웃이 현재 사용자로 불러온다.
  const alertUser = useRef(null);
  const loadAlerts = useCallback((userId) => {
    if (userId != null) alertUser.current = userId;
    if (alertUser.current == null) return Promise.resolve();
    return fetchNotifications(alertUser.current)
      .then(guard(setNotifications))
      .catch((e) => console.warn('알림 조회 실패, 예시 데이터 사용:', e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [staff, setStaff] = useState(STAFF);
  // 이번 주 근무표(알바생 조회 2-6, 점주·매니저 근무표 조회). null = 예시 모드, { published, status, assign, need } = DB 에서 읽은 결과(status: 초안·검토중·확정, 없으면 null)
  const [thisWeek, setThisWeek] = useState(null);
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
    registerStaff(rows); // 화면 직원 목록에 없는 DB 직원을 추가
    const byDb = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    setStaff((prevList) => {
      const known = new Set(prevList.map((s) => s.id));
      const prev = [...prevList, ...STAFF.filter((s) => !known.has(s.id))];
      return prev.map((st) => {
        const r = byDb[st.dbId];
        // 알바생에게는 이름·역할만 내려오므로(ranges 없음) 가능시간·최대 근무시간은 있을 때만 바꾼다
        return r ? { ...st, maxHours: Number(r.max_weekly_hours ?? st.maxHours), avail: r.ranges ? rangesToAvail(r.ranges) : st.avail, submitted: r.submitted ?? st.submitted } : st;
      });
    });
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
    registerStaff(res.staff); // 배정 표시 전에 DB 직원을 먼저 등록한다(목록에 없는 직원도 보이게)
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
    applySchedule(await api.fetchSchedule(storeId, NEXT_WEEK_START, SHIFT_ARGS));
    const rows = await fetchScheduleRows(NEXT_WEEK_START, storeId);
    setEdited(rows?.edited ?? []);
    // 이번 주는 확정·공개된 근무표만 쓴다(알바생은 DB 권한상 확정분만 읽을 수 있다)
    const cur = await api.fetchSchedule(storeId, THIS_WEEK_START, SHIFT_ARGS);
    registerStaff(cur?.staff);
    const assign = {};
    const need = {};
    (cur?.cells ?? []).forEach((c) => { assign[cellKey(c.day, c.shift)] = c.user_ids.map((uid) => staffByDbId[uid]?.id).filter(Boolean); need[cellKey(c.day, c.shift)] = c.need; });
    setThisWeek({ published: cur?.status === '확정', status: cur?.status ?? null, assign, need });
  }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 로그인 사용자가 바뀔 때마다(로그인·로그아웃·계정 전환) 그 사용자의 권한으로 다시 읽는다.
  // 로그아웃·체험 로그인이면 이전 사용자의 데이터가 남지 않도록 예시 상태로 되돌린다.
  useEffect(() => {
    epoch.current += 1;
    if (!live) {
      scheduleId.current = null; alertUser.current = null;
      setInventory(INGREDIENTS); setInventorySource('sample'); setOrders(ORDERS); setReports(SHORTAGE_REPORTS);
      restoreMockStaffRegistry(); setStaff(STAFF.slice()); // 예시 모드: 예시 직원 목록
      setNotifications(NOTIFICATIONS); setCorrection(null); setRecs({}); setRecsLoaded(false);
      setSchedState('none'); setAssign({}); setEdited([]); setNeed(NEED); setAvailSubmitted(false); setThisWeek(null);
      return;
    }
    // 실제 매장: 예시 직원 대신 DB 직원으로 채운다(이전 사용자의 직원이 남지 않게 비우고 시작)
    clearStaffRegistry(); setStaff([]); setThisWeek(null);
    reloadInventory(); reloadOrders(); reloadCorrection(); reloadRecs(); reloadReports();
    // 레이아웃이 먼저 요청한 알림 응답은 위에서 세대가 바뀌며 버려지므로, 같은 사용자로 한 번 더 읽는다(alertUser 는 레이아웃이 먼저 채워 둠)
    loadAlerts();
    api.fetchAvailability(dbUserId).then(guard((r) => r && applyMyAvail(r))).catch((e) => console.error('가능시간 조회 실패', e));
    reloadSchedule().catch((e) => console.error('스케줄 조회 실패', e));
  }, [live, dbUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장은 순서대로 한 줄로 처리한다(수정 직후 확정해도 순서가 꼬이지 않게). 실패하면 DB 값으로 되돌린다.
  const queue = useRef(Promise.resolve());
  const persist = (fn) => {
    if (!live) return Promise.resolve();
    const run = queue.current.then(fn);
    queue.current = run.catch(() => {});
    return run.catch(async (e) => { await reloadSchedule().catch(() => {}); throw e; });
  };

  // 2-1 · 가능시간 제출 (실패하면 throw → 화면이 오류 표시)
  const submitMyAvail = async (maxHours) => {
    if (live) applyMyAvail(await api.saveAvailability(dbUserId, slotsToRanges(myAvail), maxHours));
    else { setMyMaxHours(maxHours); setAvailSubmitted(true); }
  };

  // 2-3 · 스케줄 초안 자동 생성 (DB 함수가 생성·저장까지 처리한다. 실패하면 throw)
  const generateSchedule = async () => {
    if (live) {
      applySchedule(await api.generateScheduleDraft(storeId, NEXT_WEEK_START, SHIFT_ARGS));
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
    ops,
    schedState, setSchedState, assign, setAssign, need, edited, setEdited,
    generateSchedule, editScheduleCell, changeScheduleState,
    inventory, setInventory, inventorySource, lowStock, orders, reloadOrders, correction, reloadCorrection, recs, recsLoaded, reloadRecs,
    reports, setReports, reloadInventory, reloadReports, loadAlerts, notifications, setNotifications, unread, notify,
    staff, setStaff, thisWeek, menus, setMenus, clock, setClock,
    myAvail, setMyAvail, myMaxHours, availSubmitted, submitMyAvail,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
