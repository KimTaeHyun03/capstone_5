// 7-2·7-3·7-4 재료·메뉴·레시피 CSV 일괄 등록 — CSV 해석과 입력 검증.
// 등록은 DB 함수 ops_import_catalog(한 트랜잭션)가 하고, 여기서는 올리기 전에 미리 틀린 곳을 행 번호와 함께 알려 준다.

// CSV 를 칸 배열의 배열로 바꾼다(BOM·CRLF·따옴표·"" 이스케이프 지원, 빈 줄은 건너뜀)
export function csvRows(text) {
  const source = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i <= source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === undefined) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
      if (c === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === ',' || c === '\n' || c === '\r' || c === undefined) {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { if (row.some((v) => v.trim())) rows.push(row); row = []; if (c === '\r' && source[i + 1] === '\n') i++; }
    } else if (c === '"' && !value && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('CSV 따옴표 형식이 잘못되었습니다.'); value += c; }
  }
  return rows;
}

// 재료 사용 단위: 한 번에 얼마인지 알 수 있는 단위만 쓴다 ('병'·'박스' 같은 포장 단위는 발주 단위명으로)
export const INGREDIENT_UNITS = ['kg', 'g', 'L', 'mL', '개'];
const UNIT_ALIASES = { kg: 'kg', g: 'g', l: 'L', ml: 'mL', 개: '개' };
export const normalizeIngredientUnit = (v) => UNIT_ALIASES[String(v ?? '').trim().toLowerCase()] ?? null;

export const MAX_CATALOG_ROWS = 500;

// 종류별 열 정의: required 는 꼭 있어야 하는 열, optional 은 있어도 되는 열
export const CATALOG_SPEC = {
  ingredient: {
    label: '재료',
    required: ['ingredient_name', 'unit', 'unit_price', 'min_stock', 'order_quantity'],
    optional: ['order_unit_name', 'supplier'],
    sample: [
      ['ingredient_name', 'unit', 'unit_price', 'min_stock', 'order_quantity', 'order_unit_name', 'supplier'],
      ['원두', 'kg', '28000', '5', '1', 'kg', '빈하우스'],
      ['우유', 'L', '2400', '20', '12', '12L 묶음', '서울우유 대리점'],
    ],
    help: '재료 이름, 사용 단위(kg·g·L·mL·개), 사용 단위당 단가(원), 최소 보유량, 1회 발주 단위당 사용 수량(order_quantity)은 필수이고, 발주 단위명(order_unit_name)과 거래처(supplier)는 선택입니다.',
  },
  menu: {
    label: '메뉴',
    required: ['menu_name', 'price'],
    optional: ['category', 'is_on_sale', 'sale_unit'],
    sample: [
      ['menu_name', 'category', 'price', 'is_on_sale', 'sale_unit'],
      ['아메리카노', '커피', '4500', 'Y', '잔'],
      ['카페라떼', '커피', '5000', 'Y', '잔'],
    ],
    help: '메뉴 이름과 판매가(원)는 필수이고, 분류(category), 판매 여부(is_on_sale: Y/N, 비우면 판매 중), 판매 단위(sale_unit: 잔·개 등, 비우면 분류로 정함)는 선택입니다.',
  },
  recipe: {
    label: '레시피',
    required: ['menu_name', 'ingredient_name', 'quantity'],
    optional: [],
    sample: [
      ['menu_name', 'ingredient_name', 'quantity'],
      ['카페라떼', '원두', '0.018'],
      ['카페라떼', '우유', '0.2'],
    ],
    help: '한 줄에 "메뉴 1개에 들어가는 재료 1가지와 양"을 적습니다. 메뉴·재료 이름은 이미 등록한 것과 같아야 하고, 양은 재료의 사용 단위 기준입니다. CSV에 나온 메뉴의 레시피는 통째로 바뀝니다.',
  },
};

const YES = new Set(['', 'y', 'yes', 'true', '1', '판매', '판매중', '판매 중', '예', 'o']);
const NO = new Set(['n', 'no', 'false', '0', '중지', '판매중지', '판매 중지', '아니오', 'x']);

const num = (raw, label, { min = 0, exclusiveMin = false, integer = false } = {}) => {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  if (s === '' || !Number.isFinite(Number(s))) throw new Error(`${label}은(는) 숫자여야 합니다.`);
  const v = Number(s);
  if (integer && !Number.isInteger(v)) throw new Error(`${label}은(는) 정수여야 합니다.`);
  if (exclusiveMin ? v <= min : v < min) throw new Error(`${label}은(는) ${exclusiveMin ? `${min}보다 커야` : `${min} 이상이어야`} 합니다.`);
  if (v > 2147483647) throw new Error(`${label}이(가) 너무 큽니다.`);
  return v;
};
const text = (raw, label, max, { required = true } = {}) => {
  const s = String(raw ?? '').trim();
  if (!s) { if (required) throw new Error(`${label}을(를) 입력하세요.`); return ''; }
  if (s.length > max) throw new Error(`${label}은(는) ${max}자 이하여야 합니다.`);
  return s;
};
const norm = (s) => String(s).trim().toLowerCase();

// text → 등록용 행 배열. existing = { menus, ingredients }(레시피 이름 확인용). 틀린 곳이 있으면 "N행: ..." 오류를 던진다.
export function parseCatalogCSV(raw, kind, existing = {}) {
  const spec = CATALOG_SPEC[kind];
  if (!spec) throw new Error('지원하지 않는 종류입니다.');
  const table = csvRows(raw);
  const headers = (table.shift() ?? []).map((h) => h.trim());
  const known = new Set([...spec.required, ...spec.optional]);
  const missing = spec.required.filter((h) => !headers.includes(h));
  const unknown = headers.filter((h) => !known.has(h));
  if (!headers.length || missing.length || unknown.length || new Set(headers).size !== headers.length) {
    throw new Error(`CSV 헤더가 맞지 않습니다. 필수: ${spec.required.join(', ')}${spec.optional.length ? ` / 선택: ${spec.optional.join(', ')}` : ''}${missing.length ? ` (없는 열: ${missing.join(', ')})` : ''}${unknown.length ? ` (알 수 없는 열: ${unknown.join(', ')})` : ''}`);
  }
  if (!table.length) throw new Error('등록할 행이 없습니다.');
  if (table.length > MAX_CATALOG_ROWS) throw new Error(`한 번에 ${MAX_CATALOG_ROWS}행까지 등록할 수 있습니다. (${table.length}행)`);

  const menuNames = new Set((existing.menus ?? []).map((m) => norm(m.name)));
  const ingNames = new Set((existing.ingredients ?? []).map((i) => norm(i.name)));
  const seen = new Set();
  return table.map((cells, index) => {
    const line = index + 2; // 머리글이 1행
    try {
      if (cells.length !== headers.length) throw new Error(`열 수가 머리글(${headers.length}개)과 다릅니다.`);
      const r = Object.fromEntries(headers.map((h, j) => [h, cells[j].trim()]));
      if (kind === 'ingredient') {
        const name = text(r.ingredient_name, '재료 이름', 100);
        const unit = normalizeIngredientUnit(text(r.unit, '사용 단위', 20));
        if (!unit) throw new Error('사용 단위는 kg, g, L, mL, 개 중 하나로 적으세요. 병·박스처럼 용량을 알 수 없는 단위는 쓸 수 없습니다(발주 단위명에 적으세요).');
        if (seen.has(norm(name))) throw new Error(`재료 "${name}"이(가) 파일 안에 두 번 있습니다.`);
        seen.add(norm(name));
        return { name, unit, price: num(r.unit_price, '단가', { integer: true }), min: num(r.min_stock, '최소 보유량'),
          orderUnit: num(r.order_quantity, '발주 단위당 사용 수량', { exclusiveMin: true }),
          orderLabel: text(r.order_unit_name, '발주 단위명', 20, { required: false }) || unit, supplier: text(r.supplier, '거래처', 100, { required: false }) };
      }
      if (kind === 'menu') {
        const name = text(r.menu_name, '메뉴 이름', 100);
        if (seen.has(norm(name))) throw new Error(`메뉴 "${name}"이(가) 파일 안에 두 번 있습니다.`);
        seen.add(norm(name));
        const flag = norm(r.is_on_sale ?? '');
        if (!YES.has(flag) && !NO.has(flag)) throw new Error('판매 여부(is_on_sale)는 Y 또는 N으로 적으세요.');
        const unit = text(r.sale_unit, '판매 단위', 10, { required: false });
        return { name, category: text(r.category, '분류', 50, { required: false }) || '기타', price: num(r.price, '판매가', { integer: true }), onSale: YES.has(flag), ...(unit ? { unit } : {}) };
      }
      // recipe
      const menu = text(r.menu_name, '메뉴 이름', 100);
      const ingredient = text(r.ingredient_name, '재료 이름', 100);
      if (existing.menus && !menuNames.has(norm(menu))) throw new Error(`메뉴 "${menu}"이(가) 등록돼 있지 않습니다. 메뉴를 먼저 등록하세요.`);
      if (existing.ingredients && !ingNames.has(norm(ingredient))) throw new Error(`재료 "${ingredient}"이(가) 등록돼 있지 않습니다. 재료를 먼저 등록하세요.`);
      const key = `${norm(menu)}|${norm(ingredient)}`;
      if (seen.has(key)) throw new Error(`메뉴 "${menu}"에 재료 "${ingredient}"이(가) 두 번 있습니다.`);
      seen.add(key);
      return { menu, ingredient, qty: num(r.quantity, '소요량', { exclusiveMin: true }) };
    } catch (e) {
      throw new Error(`${line}행: ${e.message}`);
    }
  });
}

// 내려받기용 양식(엑셀에서 한글이 깨지지 않도록 BOM 포함)
export const templateCSV = (kind) => `﻿${CATALOG_SPEC[kind].sample.map((row) => row.join(',')).join('\r\n')}\r\n`;
