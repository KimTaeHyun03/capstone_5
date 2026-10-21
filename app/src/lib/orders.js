// 5-1 권장 발주량 · 5-2 발주 등록 · 5-3 입고 처리 — order_recommendation / purchase_order 조회와 쓰기(RPC)
import { supabase } from './supabase.js';
import { DAYS } from '../mocks/data.js';

const db = () => {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  return supabase;
};
const rpc = async (name, args) => {
  const { data, error } = await db().rpc(name, args);
  if (error) throw error;
  return data;
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateLabel = (ts) => { // '10.20(화)'
  const d = new Date(ts);
  return `${d.getMonth() + 1}.${pad(d.getDate())}(${DAYS[(d.getDay() + 6) % 7]})`;
};

// 이번 주 다음 월요일(다음 주 시작일) — DB 함수의 기본값과 같다.
export function nextMonday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + (8 - (d.getDay() || 7)));
  return ymd(d);
}

// 재료별 가장 최근 권장 발주량. 반환: { 'i1': { recommendationId, rec, use, factor, stockAtCalc, periodStart, calculatedAt } }
export async function fetchRecommendations() {
  const { data, error } = await db()
    .from('order_recommendation')
    .select('recommendation_id, ingredient_id, period_start, period_end, forecast_usage, stock_at_calc, recommended_qty, calculated_at, coef:correction_coefficient(coefficient)')
    .order('calculated_at', { ascending: false })
    .order('recommendation_id', { ascending: false })
    .limit(200);
  if (error) throw error;
  const latest = {};
  for (const r of data) {
    const key = `i${r.ingredient_id}`;
    if (latest[key]) continue; // 최신순이라 첫 행이 가장 최근
    const coef = Array.isArray(r.coef) ? r.coef[0] : r.coef;
    latest[key] = {
      recommendationId: r.recommendation_id,
      rec: Number(r.recommended_qty),
      use: Number(r.forecast_usage),
      factor: Number(coef?.coefficient ?? 1),
      stockAtCalc: Number(r.stock_at_calc),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      calculatedAt: r.calculated_at,
    };
  }
  return latest;
}

export const calculateRecommendations = (periodStart = null) =>
  rpc('calculate_order_recommendations', { p_period_start: periodStart });

// 발주 목록. 같은 시각(ordered_at)에 등록한 품목을 한 건으로 묶는다. id 는 'PO-{첫 발주ID}'.
export async function fetchOrders() {
  const { data, error } = await db()
    .from('purchase_order')
    .select('order_id, ingredient_id, order_qty, status, ordered_at')
    .order('ordered_at', { ascending: false })
    .order('order_id', { ascending: true });
  if (error) throw error;
  const groups = new Map();
  for (const r of data) {
    if (!groups.has(r.ordered_at)) groups.set(r.ordered_at, []);
    groups.get(r.ordered_at).push(r);
  }
  return [...groups.values()].map((rows) => ({
    id: `PO-${rows[0].order_id}`,
    date: dateLabel(rows[0].ordered_at),
    status: rows.every((r) => r.status === '입고완료') ? '입고완료' : '대기',
    lines: rows.map((r) => ({ id: `i${r.ingredient_id}`, orderId: r.order_id, qty: Number(r.order_qty) })),
  }));
}

// lines: [{ ingredientId, recommendationId, qty }]
export const placeOrder = (userId, lines) =>
  rpc('place_purchase_order', {
    p_user_id: userId,
    p_lines: lines.map((l) => ({ ingredient_id: l.ingredientId, recommendation_id: l.recommendationId ?? null, qty: l.qty })),
  });

// lines: [{ orderId, receivedQty, diffReason }]
export const receiveOrder = (userId, lines) =>
  rpc('receive_purchase_order', {
    p_user_id: userId,
    p_lines: lines.map((l) => ({ order_id: l.orderId, received_qty: l.receivedQty, diff_reason: l.diffReason ?? null })),
  });
