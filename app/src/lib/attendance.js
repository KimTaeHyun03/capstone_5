// 3-1 출퇴근 · 3-2 급여 · 3-3 인건비 비교 — attendance / payroll / shift_assignment 조회와 출퇴근(RPC)
import { supabase } from './supabase.js';
import { DAYS } from '../domain/constants.js';
import { attendanceFlags } from '../domain/index.js';

const db = () => {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  return supabase;
};
const rpc = async (name, args) => {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
};

// 한국 시간(DB 판정 기준)으로 날짜·시각을 읽는다. 브라우저 시간대와 상관없이 같은 값이 나온다.
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function kst(ts = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`;
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // 월=0 … 일=6
  return { ymd, hm: `${p.hour}:${p.minute}`, m: Number(p.month), d: Number(p.day), dow, label: `${Number(p.month)}.${p.day}(${DAYS[dow]})` };
}
const startOfDayKst = (ymd) => `${ymd}T00:00:00+09:00`;
const hm = (t) => String(t).slice(0, 5); // '17:00:00' → '17:00'
const hoursBetween = (a, b) => { const [ah, am] = hm(a).split(':').map(Number); const [bh, bm] = hm(b).split(':').map(Number); return (bh * 60 + bm - ah * 60 - am) / 60; };
const monthStartYmd = (k) => `${k.ymd.slice(0, 8)}01`;
const weekStartYmd = (k) => { const d = new Date(`${k.ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - k.dow); return d.toISOString().slice(0, 10); };
const weekRangeLabel = (startYmd) => { // '10.19 – 10.25'
  const e = new Date(`${startYmd}T00:00:00Z`); e.setUTCDate(e.getUTCDate() + 6);
  const md = (iso) => iso.slice(5, 10).replace('-', '.');
  return `${md(startYmd)} – ${md(e.toISOString())}`;
};

// 3-1 오늘의 확정 배정(예정)과 오늘 출퇴근 기록
export async function fetchToday(userId) {
  const today = kst();
  const [pl, rc] = await Promise.all([
    db().from('shift_assignment')
      .select('planned_start, planned_end, work_schedule!inner(status)')
      .eq('user_id', userId).eq('work_date', today.ymd).eq('work_schedule.status', '확정')
      .order('planned_start').limit(1),
    db().from('attendance')
      .select('clock_in, clock_out, status')
      .eq('user_id', userId).gte('clock_in', startOfDayKst(today.ymd))
      .order('clock_in', { ascending: false }).limit(1),
  ]);
  if (pl.error) throw pl.error;
  if (rc.error) throw rc.error;
  const plan = pl.data[0] ? { start: hm(pl.data[0].planned_start), end: hm(pl.data[0].planned_end) } : null;
  const r = rc.data[0];
  return { plan, rec: r ? { in: kst(r.clock_in).hm, out: r.clock_out ? kst(r.clock_out).hm : null, status: r.status } : { in: null, out: null }, today };
}
export const clockIn = (userId) => rpc('clock_in', { p_user_id: userId });
export const clockOut = (userId) => rpc('clock_out', { p_user_id: userId });

// 3-2 이번 달 내 근무 내역과 급여. shifts: [{ date, start, end, hours, flag }], holidayPay: 이번 달에 걸친 주의 주휴수당 합
export async function fetchMyPay(userId) {
  const now = kst();
  const from = monthStartYmd(now);
  const [u, at, pr] = await Promise.all([
    db().from('user_account').select('hourly_wage').eq('user_id', userId).maybeSingle(),
    db().from('attendance')
      .select('clock_in, clock_out, actual_hours, assignment:shift_assignment(planned_start, planned_end)')
      .eq('user_id', userId).not('clock_out', 'is', null).gte('clock_in', startOfDayKst(from)).order('clock_in'),
    db().from('payroll').select('holiday_pay, period_start').eq('user_id', userId).gte('period_start', weekStartYmd(kst(startOfDayKst(from)))),
  ]);
  for (const r of [u, at, pr]) if (r.error) throw r.error;
  if (u.data?.hourly_wage == null) throw new Error('시급 정보를 읽을 수 없습니다');
  const shifts = at.data.map((a) => {
    const ci = kst(a.clock_in);
    const co = kst(a.clock_out);
    const pl = Array.isArray(a.assignment) ? a.assignment[0] : a.assignment;
    const flags = pl ? attendanceFlags({ plan: [hm(pl.planned_start), hm(pl.planned_end)], actual: [ci.hm, co.hm] }) : [];
    return { date: ci.label, start: ci.hm, end: co.hm, hours: Number(a.actual_hours), flag: flags[0] ?? null };
  });
  return {
    wage: u.data.hourly_wage, shifts, month: now.m,
    holidayPay: pr.data.reduce((s, r) => s + Number(r.holiday_pay ?? 0), 0),
  };
}

// 3-3 이번 달 직원별 예정·실제 시간과 이번 주 출퇴근 기록
export async function fetchLabor() {
  const now = kst();
  const from = monthStartYmd(now);
  const [us, as, at] = await Promise.all([
    db().from('user_account').select('user_id, name, role, hourly_wage').in('role', ['매니저', '알바생']).order('user_id'),
    db().from('shift_assignment')
      .select('user_id, planned_start, planned_end, work_schedule!inner(status)')
      .eq('work_schedule.status', '확정').gte('work_date', from).lte('work_date', now.ymd),
    db().from('attendance')
      .select('attendance_id, user_id, clock_in, clock_out, actual_hours, assignment:shift_assignment(planned_start, planned_end)')
      .gte('clock_in', startOfDayKst(from)).order('clock_in'),
  ]);
  for (const r of [us, as, at]) if (r.error) throw r.error;

  const plan = {};
  for (const a of as.data) plan[a.user_id] = (plan[a.user_id] ?? 0) + hoursBetween(a.planned_start, a.planned_end);
  const actual = {};
  for (const a of at.data) if (a.clock_out) actual[a.user_id] = (actual[a.user_id] ?? 0) + Number(a.actual_hours);
  const rows = us.data
    .filter((u) => plan[u.user_id] || actual[u.user_id])
    .map((u) => ({ key: u.user_id, name: u.name, wage: u.hourly_wage ?? 0, planHours: +(plan[u.user_id] ?? 0).toFixed(2), actualHours: +(actual[u.user_id] ?? 0).toFixed(2) }));

  const nameOf = Object.fromEntries(us.data.map((u) => [u.user_id, u.name]));
  const week = weekStartYmd(now);
  const att = at.data.filter((a) => kst(a.clock_in).ymd >= week).map((a) => {
    const ci = kst(a.clock_in);
    const co = a.clock_out ? kst(a.clock_out) : null;
    const pl = Array.isArray(a.assignment) ? a.assignment[0] : a.assignment;
    const planR = pl ? [hm(pl.planned_start), hm(pl.planned_end)] : null;
    return {
      id: a.attendance_id, name: nameOf[a.user_id] ?? '', dateLabel: ci.label,
      plan: planR, actual: [ci.hm, co ? co.hm : null],
      flags: planR ? attendanceFlags({ plan: planR, actual: [ci.hm, co ? co.hm : null] }) : [],
      hours: a.clock_out ? Number(a.actual_hours) : null,
    };
  });
  return { rows, att, month: now.m, weekRange: weekRangeLabel(week) };
}
