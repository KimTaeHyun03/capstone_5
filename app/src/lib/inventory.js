// 4-2 재고 현황 조회 — ingredient + inventory(1:1)를 화면이 쓰는 모양으로 바꿔 돌려준다.
import { supabase } from './supabase.js';
import { INGREDIENTS } from '../mocks/data.js';

// DB에 아직 없는 값(use 소진량·supplier 거래처)은 13단계(발주) 연결 전까지 예시 값을 쓴다.
const sampleByName = Object.fromEntries(INGREDIENTS.map((i) => [i.name, i]));

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
