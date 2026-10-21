// 4-2 재고 현황 조회 — ingredient + inventory(1:1)를 화면이 쓰는 모양으로 바꿔 돌려준다.
import { supabase } from './supabase.js';
import { INGREDIENTS } from '../mocks/data.js';

// DB에 아직 없는 값(use 소진량·supplier 거래처)은 13단계(발주) 연결 전까지 예시 값을 쓴다.
const sampleByName = Object.fromEntries(INGREDIENTS.map((i) => [i.name, i]));

// 4-3 실사('실사 보정', qty = 실제로 센 수량) · 폐기('폐기', qty = 버린 수량). entries: [{ ingredientId, qty }]
// 한 품목이라도 실패하면 거기서 멈추고 오류를 던진다(앞서 반영된 품목은 그대로 남는다).
export async function recordAdjustments(entries, type, userId, reason = null) {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  for (const e of entries) {
    const { error } = await supabase.rpc('record_stock_adjustment', {
      p_ingredient_id: e.ingredientId, p_type: type, p_qty: e.qty, p_user_id: userId, p_reason: reason,
    });
    if (error) throw error;
  }
}

export async function fetchInventory() {
  if (!supabase) throw new Error('Supabase 환경변수가 없습니다');
  const { data, error } = await supabase
    .from('ingredient')
    .select('ingredient_id, ingredient_name, use_unit, conversion_rate, unit_price, min_stock, inventory(current_qty)')
    .order('ingredient_id');
  if (error) throw error;
  return data.map((r) => {
    const sample = sampleByName[r.ingredient_name] ?? {};
    const inv = Array.isArray(r.inventory) ? r.inventory[0] : r.inventory; // 1:1 관계
    return {
      ...sample,
      id: `i${r.ingredient_id}`, // 레시피·발주·신고 화면이 아직 예시 id('i1')로 재료를 참조한다
      ingredientId: r.ingredient_id, // DB 쓰기(실사·신고 등)에 쓰는 실제 id
      name: r.ingredient_name,
      unit: r.use_unit,
      price: r.unit_price,
      min: Number(r.min_stock),
      orderUnit: Number(r.conversion_rate),
      stock: Number(inv?.current_qty ?? 0),
    };
  });
}
