// 2-3 ~ 2-6 · 근무 스케줄(work_schedule) · 근무 배정(shift_assignment) 조회·저장.
// 화면 상태(assign: { '요일-시프트': [직원 id] }) ↔ DB 행 변환을 여기서만 한다.
// 알림(notification) 기록은 DB 트리거가 상태 전환을 보고 자동으로 남긴다(마이그레이션 20261021000000).
import { supabase } from './supabase.js';
import { SHIFTS, staffById, staffByDbId } from '../mocks/data.js';
import { cellKey, pad2 } from '../domain/index.js';

// work_schedule.status ↔ 화면 상태
const TO_DB = { draft: '초안', review: '검토중', published: '확정' };
const FROM_DB = { 초안: 'draft', 검토중: 'review', 확정: 'published' };

// 화면 직원 id ↔ DB user_id 는 현재 직원 목록(DB 에서 읽은 직원 포함)으로 그때그때 찾는다
const staffIdOf = (userId) => staffByDbId[userId]?.id;
const userIdOf = (id) => staffById[id]?.userId;

const hhmm = (h) => `${pad2(h)}:00`;
const dateOf = (week, di) => {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + di);
  return d.toISOString().slice(0, 10);
};
const dayIndex = (week, date) => Math.round((Date.parse(date) - Date.parse(week)) / 86400000);
const cellOf = (k) => {
  const [di, sid] = k.split('-');
  return { di: Number(di), s: SHIFTS.find((x) => x.id === sid) };
};

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// 대상 주의 스케줄 1건 + 배정. 없으면 null
export async function fetchSchedule(week, storeId) {
  const sch = check(await supabase.from('work_schedule').select('*').eq('store_id', storeId).eq('target_week', week).maybeSingle());
  if (!sch) return null;
  const rows = check(await supabase.from('shift_assignment').select('*').eq('schedule_id', sch.schedule_id));
  const assign = {};
  const edited = new Set();
  rows.forEach((r) => {
    const s = SHIFTS.find((x) => hhmm(x.start) === r.planned_start.slice(0, 5));
    const id = staffIdOf(r.user_id);
    if (!s || !id) return;
    const k = cellKey(dayIndex(week, r.work_date), s.id);
    (assign[k] ||= []).push(id);
    if (r.is_modified) edited.add(k);
  });
  return { id: sch.schedule_id, state: FROM_DB[sch.status] ?? 'draft', assign, edited: [...edited] };
}

const rowsOf = (scheduleId, week, k, ids, modifiedBy) => {
  const { di, s } = cellOf(k);
  return ids.map((id) => ({
    schedule_id: scheduleId, user_id: userIdOf(id), work_date: dateOf(week, di),
    planned_start: hhmm(s.start), planned_end: hhmm(s.end),
    is_modified: modifiedBy != null, modified_by: modifiedBy ?? null, has_warning: false,
  }));
};

// 2-3 · 초안 저장 — 같은 주 스케줄이 있으면 초안으로 되돌리고 배정을 통째로 바꾼다
export async function saveDraft(week, assign, storeId) {
  const sch = check(await supabase.from('work_schedule').upsert({
    store_id: storeId, target_week: week, status: TO_DB.draft, created_at: new Date().toISOString(),
    confirmed_by: null, confirmed_at: null, is_published: false, published_at: null,
  }, { onConflict: 'store_id,target_week' }).select('schedule_id').single());
  check(await supabase.from('shift_assignment').delete().eq('schedule_id', sch.schedule_id));
  const rows = Object.entries(assign).flatMap(([k, ids]) => rowsOf(sch.schedule_id, week, k, ids));
  if (rows.length) check(await supabase.from('shift_assignment').insert(rows));
  return sch.schedule_id;
}

// 2-4 · 한 칸(요일×시프트) 배정 교체. modifiedBy = 수정한 사용자 user_id
export async function saveCell(scheduleId, week, k, ids, modifiedBy) {
  const { di, s } = cellOf(k);
  check(await supabase.from('shift_assignment').delete()
    .eq('schedule_id', scheduleId).eq('work_date', dateOf(week, di)).eq('planned_start', hhmm(s.start)));
  const rows = rowsOf(scheduleId, week, k, ids, modifiedBy);
  if (rows.length) check(await supabase.from('shift_assignment').insert(rows));
}

// 2-4 · E4 수정 배정 재검증 결과를 has_warning 에 반영 (cells = domain.warningCells 결과)
export async function syncWarnings(scheduleId, week, cells) {
  check(await supabase.from('shift_assignment').update({ has_warning: false }).eq('schedule_id', scheduleId).eq('has_warning', true));
  for (const { k, id } of cells) {
    const { di, s } = cellOf(k);
    check(await supabase.from('shift_assignment').update({ has_warning: true })
      .eq('schedule_id', scheduleId).eq('user_id', userIdOf(id)).eq('work_date', dateOf(week, di)).eq('planned_start', hhmm(s.start)));
  }
}

// 2-4 검토 요청·완료, 2-5 확정·공개, 다시 편집. byUserId = 확정한 점주
export async function setScheduleState(scheduleId, state, byUserId) {
  const now = new Date().toISOString();
  const patch = state === 'published'
    ? { status: TO_DB.published, confirmed_by: byUserId, confirmed_at: now, is_published: true, published_at: now }
    : { status: TO_DB[state], is_published: false };
  check(await supabase.from('work_schedule').update(patch).eq('schedule_id', scheduleId));
}
