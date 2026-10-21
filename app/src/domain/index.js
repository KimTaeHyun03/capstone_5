/* 화면과 분리된 계산 로직 (순수 함수). DB 연동 후에도 그대로 쓴다. */
import { DAYS, HOURS, FORECAST, SHIFTS, STAFF, INGREDIENTS, MENUS, RECIPES } from '../mocks/data.js';

// 1-3 · 시간대 예측 매출(천원) → 필요 인원
export const needStaff = (sales) => (sales < 50 ? 1 : sales < 100 ? 2 : 3);

export const shiftHours = (s) => s.end - s.start;
export const cellKey = (di, sid) => `${di}-${sid}`;
export const pad2 = (n) => String(n).padStart(2, '0');
export const fmtRange = (r) => `${pad2(r[0])}–${pad2(r[1])}`;

export const canWork = (staff, di, shift) => {
  const a = staff.avail[di];
  return !!a && a[0] <= shift.start && a[1] >= shift.end;
};

// 시프트별 필요 인원 = 시프트 안 시간대 중 최대 필요 인원
export const NEED = {};
DAYS.forEach((_, di) =>
  SHIFTS.forEach((s) => {
    const idx = HOURS.map((h, i) => (h >= s.start && h < s.end ? i : -1)).filter((i) => i >= 0);
    NEED[cellKey(di, s.id)] = Math.max(...idx.map((i) => needStaff(FORECAST[di][i])));
  })
);

// 2-2 · 시간대별 지원 인원 (availability 집계값)
export const supportCount = (di, shift) => STAFF.filter((st) => canWork(st, di, shift)).length;

// 2-3 · 스케줄 초안 자동 생성 — 필요 인원이 많은 칸부터, 남은 근무시간이 많은 사람 우선
export function generateDraft() {
  const remaining = Object.fromEntries(STAFF.map((s) => [s.id, s.maxHours]));
  const cells = [];
  DAYS.forEach((_, di) => SHIFTS.forEach((s) => cells.push({ di, s })));
  cells.sort((a, b) => NEED[cellKey(b.di, b.s.id)] - NEED[cellKey(a.di, a.s.id)] || b.di - a.di);
  const out = {};
  cells.forEach(({ di, s }) => {
    const need = NEED[cellKey(di, s.id)];
    const picks = STAFF.filter((st) => canWork(st, di, s) && remaining[st.id] >= shiftHours(s))
      .sort((a, b) => remaining[b.id] - remaining[a.id])
      .slice(0, need)
      .map((st) => st.id);
    picks.forEach((id) => (remaining[id] -= shiftHours(s)));
    out[cellKey(di, s.id)] = picks;
  });
  return out;
}

export const hoursOf = (assign) => {
  const h = Object.fromEntries(STAFF.map((s) => [s.id, 0]));
  Object.entries(assign).forEach(([k, ids]) => {
    const s = SHIFTS.find((x) => x.id === k.split('-')[1]);
    ids.forEach((id) => (h[id] += shiftHours(s)));
  });
  return h;
};

export const shortCells = (assign) => Object.keys(NEED).filter((k) => (assign[k] || []).length < NEED[k]);

// 2-4 · 수정 배정 재검증 (주 최대 근무시간·가능시간 위반)
export function violations(assign) {
  const hrs = hoursOf(assign);
  const list = [];
  STAFF.forEach((st) => { if (hrs[st.id] > st.maxHours) list.push(`${st.name} 주 최대 ${st.maxHours}시간 초과 (${hrs[st.id]}시간)`); });
  Object.entries(assign).forEach(([k, ids]) => {
    const [di, sid] = k.split('-');
    const s = SHIFTS.find((x) => x.id === sid);
    ids.forEach((id) => {
      const st = STAFF.find((x) => x.id === id);
      if (!canWork(st, Number(di), s)) list.push(`${st.name} ${DAYS[di]} ${s.label} 가능시간 밖 배정`);
    });
  });
  return list;
}

// 5-1 · 권장 발주량 = 예상 소진량 × 보정 계수 − 현재 재고 (발주 단위 올림)
export const recommendQty = (it) => {
  const raw = it.use * it.factor - it.stock;
  return raw <= 0 ? 0 : Math.ceil(raw / it.orderUnit) * it.orderUnit;
};

export const stockLevel = (it) => (it.stock < it.min ? 'low' : it.stock < it.min * 1.5 ? 'warn' : 'ok');

// 7-4 · 메뉴 원가
const ingById = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i]));
export const menuCost = (menuId) => Math.round((RECIPES[menuId] || []).reduce((a, [iid, q]) => a + ingById[iid].price * q, 0));
export const menusWithoutRecipe = () => MENUS.filter((m) => !(RECIPES[m.id] || []).length);

// 3-1 · 지각·조퇴 판정
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export function attendanceFlags(rec) {
  const flags = [];
  if (rec.actual[0] && toMin(rec.actual[0]) > toMin(rec.plan[0])) flags.push(`지각 ${toMin(rec.actual[0]) - toMin(rec.plan[0])}분`);
  if (rec.actual[1] && toMin(rec.actual[1]) < toMin(rec.plan[1])) flags.push(`조퇴 ${toMin(rec.plan[1]) - toMin(rec.actual[1])}분`);
  return flags;
}
export const workedHours = (rec) => (rec.actual[0] && rec.actual[1] ? (toMin(rec.actual[1]) - toMin(rec.actual[0])) / 60 : null);

// 6-2 · 보정 계수 = 실제 소진 합 / 예측 소진 합 (0.80–1.20 범위로 제한)
export function coefficient(errors, iid) {
  const rows = errors.map((e) => e.rows[iid]).filter(Boolean);
  const f = rows.reduce((a, r) => a + r[0], 0);
  const a = rows.reduce((s, r) => s + r[1], 0);
  return f ? Math.min(1.2, Math.max(0.8, a / f)) : 1;
}

// 표시 형식
export const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export const man = (thousand) => (thousand / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
export const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
