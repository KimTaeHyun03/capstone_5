// 6-1 오차·폐기 리포트 · 6-2 보정 계수 — forecast_error / correction_coefficient 조회, 마감 실행(RPC)
import { supabase } from './supabase.js';

const db = () => {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  return supabase;
};

const md = (s) => { const [, m, d] = s.split('-'); return `${m}.${d}`; };

// 최근 3개 기간의 재료별 [예측, 실제, 폐기]와 재료별 최신 보정 계수.
// 반환: { errors: [{ period: '10.05–10.11', rows: { i1: [예측, 실제, 폐기] } }], coefs: { i1: { value, prev } } }
export async function fetchCorrection() {
  const [err, coef] = await Promise.all([
    db().from('forecast_error')
      .select('ingredient_id, period_start, period_end, actual_usage, forecast_usage, waste_qty')
      .order('period_end', { ascending: false }).limit(300),
    db().from('correction_coefficient')
      .select('ingredient_id, coefficient, previous_value, effective_from, applied_at')
      .order('effective_from', { ascending: false }).order('applied_at', { ascending: false }).limit(300),
  ]);
  if (err.error) throw err.error;
  if (coef.error) throw coef.error;

  const periods = new Map(); // 최신 기간부터
  for (const r of err.data) {
    const key = `${r.period_start}|${r.period_end}`;
    if (!periods.has(key)) periods.set(key, { start: r.period_start, end: r.period_end, rows: {} });
    periods.get(key).rows[`i${r.ingredient_id}`] = [Number(r.forecast_usage), Number(r.actual_usage), Number(r.waste_qty ?? 0)];
  }
  const errors = [...periods.values()].slice(0, 3).reverse()
    .map((p) => ({ period: `${md(p.start)}–${md(p.end)}`, rows: p.rows }));

  const coefs = {};
  for (const c of coef.data) {
    const key = `i${c.ingredient_id}`;
    if (!coefs[key]) coefs[key] = { value: Number(c.coefficient), prev: c.previous_value == null ? null : Number(c.previous_value) };
  }
  return { errors, coefs };
}

// 개발용: 지난주(또는 지정 기간)를 마감하고 보정 계수를 계산한다. 운영에서는 스케줄러(15단계)가 실행한다.
export async function runPeriodClose(periodStart = null) {
  const { data, error } = await db().rpc('run_period_close', { p_period_start: periodStart });
  if (error) throw error;
  return data;
}
