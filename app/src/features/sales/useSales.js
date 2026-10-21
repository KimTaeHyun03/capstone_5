/* 1-2 · 1-3 매출 데이터 — sales_summary·sales_forecast·sale 조회
   화면에는 요일(0=월…6=일) × 시간대(HOURS) 행렬, 단위 천원으로 넘긴다.
   Supabase 가 연결되지 않은 예시 모드에서는 mocks 값을 같은 모양으로 돌려준다. */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { DAYS, HOURS, LAST_WEEK, AVG_4W, FORECAST, MENUS, THIS_DATES, NEXT_DATES } from '../../mocks/data.js';
import { needStaff } from '../../domain/index.js';

const WEEKS = 4;
const pad2 = (n) => String(n).padStart(2, '0');
const emptyMatrix = (v = 0) => DAYS.map(() => HOURS.map(() => v));

// 'YYYY-MM-DD' 를 시간대 영향 없이 다룬다
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const isoDate = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
export const weekStartOf = (s) => addDays(s, -((parseDate(s).getUTCDay() + 6) % 7));
const weekDates = (start) => DAYS.map((_, i) => { const d = parseDate(addDays(start, i)); return `${d.getUTCMonth() + 1}.${pad2(d.getUTCDate())}`; });

// 오늘 기준 다음 주 월요일 (브라우저 현지 날짜)
export function nextWeekStart() {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return addDays(weekStartOf(today), 7);
}

export const rangeLabel = (dates) => `${dates[0]}(월) – ${dates[6]}(일)`;

const toThousand = (won) => Math.round(won / 1000);
const slotIndex = (slot) => HOURS.indexOf(slot);

function demoData() {
  return {
    last: { matrix: LAST_WEEK, start: null, dates: THIS_DATES },
    avg: { matrix: AVG_4W, weeks: 4 },
    forecast: {
      matrix: FORECAST, start: null, dates: NEXT_DATES,
      staff: FORECAST.map((r) => r.map(needStaff)),
      more: emptyMatrix(false),
    },
    menuSales: MENUS.filter((m) => m.onSale).map((m) => ({ id: m.id, name: m.name, category: m.category, qty: m.sold, amount: m.sold * m.price })),
  };
}

async function loadSummary() {
  const { data, error } = await supabase.from('sales_summary')
    .select('base_date, day_of_week, time_slot, sales_amount')
    .eq('is_confirmed', true)
    .order('base_date', { ascending: false })
    .limit(WEEKS * 7 * 24);
  if (error) throw error;
  if (!data.length) return { last: null, avg: null };

  const weeks = new Map(); // 주 시작일 → 행렬
  for (const r of data) {
    const hi = slotIndex(r.time_slot);
    if (hi < 0) continue;
    const wk = weekStartOf(r.base_date);
    if (!weeks.has(wk)) {
      if (weeks.size === WEEKS) continue;
      weeks.set(wk, emptyMatrix());
    }
    weeks.get(wk)[r.day_of_week][hi] += r.sales_amount;
  }
  const list = [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const [lastStart, lastWon] = list[0];
  const avgWon = emptyMatrix().map((row, di) => row.map((_, hi) => list.reduce((a, [, m]) => a + m[di][hi], 0) / list.length));
  return {
    last: { matrix: lastWon.map((r) => r.map(toThousand)), start: lastStart, dates: weekDates(lastStart) },
    avg: { matrix: avgWon.map((r) => r.map(toThousand)), weeks: list.length },
  };
}

async function loadForecast() {
  const { data, error } = await supabase.from('sales_forecast')
    .select('target_week, day_of_week, time_slot, forecast_amount, required_staff, needs_more_staff')
    .order('target_week', { ascending: false })
    .limit(7 * 24 * 2);
  if (error) throw error;
  if (!data.length) return null;
  const start = data[0].target_week;
  const matrix = emptyMatrix();
  const staff = emptyMatrix(1);
  const more = emptyMatrix(false);
  for (const r of data) {
    const hi = slotIndex(r.time_slot);
    if (r.target_week !== start || hi < 0) continue;
    matrix[r.day_of_week][hi] = toThousand(r.forecast_amount);
    staff[r.day_of_week][hi] = r.required_staff ?? needStaff(toThousand(r.forecast_amount));
    more[r.day_of_week][hi] = !!r.needs_more_staff;
  }
  return { matrix, staff, more, start, dates: weekDates(start) };
}

// 메뉴별 판매 — 1-1 판매 기록(sale)이 쌓이기 전에는 비어 있다
async function loadMenuSales(start) {
  if (!start) return [];
  const { data, error } = await supabase.from('sale')
    .select('menu_id, quantity, amount, menu:menu_id (menu_name, category)')
    .gte('sold_at', `${start}T00:00:00+09:00`)
    .lt('sold_at', `${addDays(start, 7)}T00:00:00+09:00`);
  if (error) throw error;
  const byMenu = new Map();
  for (const r of data) {
    const m = byMenu.get(r.menu_id) || { id: r.menu_id, name: r.menu?.menu_name, category: r.menu?.category, qty: 0, amount: 0 };
    m.qty += r.quantity;
    m.amount += r.amount;
    byMenu.set(r.menu_id, m);
  }
  return [...byMenu.values()];
}

// 화면에 필요한 매출 데이터를 한 번에 조회 (훅과 테스트에서 같이 쓴다)
export async function fetchSales() {
  const [summary, forecast] = await Promise.all([loadSummary(), loadForecast()]);
  const menuSales = await loadMenuSales(summary.last?.start);
  return { ...summary, forecast, menuSales };
}

export function useSales() {
  const demo = !supabase;
  const [state, setState] = useState(() => (demo ? { loading: false, error: null, ...demoData() } : { loading: true, error: null }));
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (demo) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const data = await fetchSales();
        if (alive) setState({ loading: false, error: null, ...data });
      } catch (e) {
        console.error(e);
        if (alive) setState({ loading: false, error: e.message || String(e) });
      }
    })();
    return () => { alive = false; };
  }, [demo, version]);

  return { ...state, demo, reload };
}

// 1-3 · 예측 생성 (점주) — DB 함수 generate_sales_forecast
export async function generateForecast(targetWeek) {
  const { data, error } = await supabase.rpc('generate_sales_forecast', { p_target_week: targetWeek });
  if (error) throw error;
  return data;
}
