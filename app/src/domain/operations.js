// 8~10단계 공통 검증. 날짜/집계 기준은 매장 시간대 Asia/Seoul.
export const dateKST = (date = new Date()) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export function monday(date = dateKST()) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function number(value, label, min = 0, integer = false) {
  const n = Number(value);
  if (String(value).trim() === '' || !Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new Error(`${label}: ${min} 이상의 ${integer ? '정수' : '숫자'}를 입력하세요.`);
  return n;
}
export function required(value, label, max = 100) {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) throw new Error(`${label}: 1~${max}자로 입력하세요.`);
  return s;
}
export function validateSales(rows, menus, existing = []) {
  if (!rows.length || rows.length > 1000) throw new Error('한 번에 1~1,000행을 등록하세요.');
  const seen = new Set(existing.map(r => `${r.payment_no}|${r.menu_id}`));
  const paymentTimes = new Map(existing.map(r => [r.payment_no, new Date(r.sold_at).toISOString()]));
  return rows.map((r, index) => {
    try {
      const menu = menus.find(m => String(m.id) === String(r.menu_id));
      if (!menu || !menu.onSale) throw new Error('판매 중인 메뉴 ID를 선택하세요.');
      const payment_no = required(r.payment_no, '결제번호', 30);
      const key = `${payment_no}|${menu.id}`;
      if (seen.has(key)) throw new Error('동일 결제번호·메뉴가 이미 있습니다. 수량을 한 행으로 합쳐 주세요.');
      seen.add(key);
      const raw = String(r.sold_at).trim();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(raw)) throw new Error('판매일시 형식이 올바르지 않습니다.');
      const time = new Date(/(Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw}+09:00`);
      if (!Number.isFinite(time.getTime()) || time > new Date()) throw new Error('판매일시는 현재 이전의 유효한 날짜여야 합니다.');
      const calendar = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== raw.slice(0, 10)) throw new Error('존재하지 않는 날짜입니다.');
      const sold_at = time.toISOString();
      if (paymentTimes.has(payment_no) && paymentTimes.get(payment_no) !== sold_at) throw new Error('한 결제의 판매일시는 같아야 합니다.');
      paymentTimes.set(payment_no, sold_at);
      const quantity = number(r.quantity, '수량', 1, true);
      const amount = number(r.amount, '금액', 0, true);
      if (quantity > 2147483647 || amount > 2147483647) throw new Error('수량 또는 금액이 허용 범위를 초과합니다.');
      return { payment_no, menu_id: menu.id, sold_at, quantity, amount };
    } catch (error) { throw new Error(`${index + 1}행: ${error.message}`); }
  });
}
export function parseSalesCSV(text) {
  const source = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i <= source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === undefined) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
      if (c === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && source[i + 1] === '\n') i++; }
    } else if (c === '"' && !value && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('CSV 따옴표 형식이 잘못되었습니다.'); value += c; }
  }
  const headers = rows.shift()?.map(s => s.trim());
  const expected = ['payment_no', 'menu_id', 'sold_at', 'quantity', 'amount'];
  if (!headers || headers.length !== 5 || new Set(headers).size !== 5 || expected.some(h => !headers.includes(h))) throw new Error(`CSV 헤더는 ${expected.join(',')} 이어야 합니다.`);
  return rows.map((r, i) => { if (r.length !== 5) throw new Error(`CSV ${i + 2}행의 열 수가 다릅니다.`); return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()])); });
}
export function summarizeSales(sales) {
  const buckets = new Map();
  for (const sale of sales) {
    const local = new Date(new Date(sale.sold_at).getTime() + 9 * 3600000);
    const base_date = local.toISOString().slice(0, 10), time_slot = local.getUTCHours();
    const key = `${base_date}|${time_slot}`;
    const row = buckets.get(key) || { base_date, time_slot, day_of_week: (local.getUTCDay() + 6) % 7, sales_amount: 0, payments: new Set() };
    row.sales_amount += sale.amount; row.payments.add(sale.payment_no); buckets.set(key, row);
  }
  return [...buckets.values()].map(({ payments, ...r }) => ({ ...r, order_count: payments.size })).sort((a, b) => `${a.base_date}${String(a.time_slot).padStart(2, '0')}`.localeCompare(`${b.base_date}${String(b.time_slot).padStart(2, '0')}`));
}
export function covers(intervals, start, end) {
  let until = start;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (a > until) break;
    if (b > until) until = b;
    if (until >= end) return true;
  }
  return false;
}
export const timeNumber = t => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60;
export function availabilityFor(rows, userId, day, week) {
  return rows.filter(r => !r.is_unavailable && String(r.user_id) === String(userId) && r.day_of_week === day && r.target_week === week).map(r => [timeNumber(r.start_time), timeNumber(r.end_time)]);
}
export const recipeCost = (lines, ingredients) => Math.round(lines.reduce((sum, [id, qty]) => sum + (ingredients.find(i => String(i.id) === String(id))?.price || 0) * qty, 0));
