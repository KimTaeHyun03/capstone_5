import test from 'node:test';
import assert from 'node:assert/strict';
import { csvRows, parseCatalogCSV, templateCSV, CATALOG_SPEC } from '../src/domain/catalogCsv.js';

const NL = '\n';
const csv = (...lines) => lines.join(NL) + NL;

test('ingredient CSV: required and optional columns, BOM, CRLF, quoted comma, defaults', () => {
  const text = '﻿' + ['ingredient_name,unit,unit_price,min_stock,order_quantity,supplier', '원두,kg,28000,5,1,"빈하우스, 본점"', '우유,L,"2,400",20,12,'].join('\r\n') + '\r\n';
  const rows = parseCatalogCSV(text, 'ingredient');
  assert.deepEqual(rows[0], { name: '원두', unit: 'kg', price: 28000, min: 5, orderUnit: 1, orderLabel: 'kg', supplier: '빈하우스, 본점' });
  assert.equal(rows[1].price, 2400);
  assert.equal(rows[1].orderLabel, 'L');
  assert.equal(rows[1].supplier, '');
});

test('ingredient CSV: errors carry the file line number', () => {
  const head = 'ingredient_name,unit,unit_price,min_stock,order_quantity';
  assert.throws(() => parseCatalogCSV(csv(head, '원두,kg,abc,5,1'), 'ingredient'), /^Error: 2행: 단가/);
  assert.throws(() => parseCatalogCSV(csv(head, '원두,kg,100,5,1', '우유,L,100,-1,12'), 'ingredient'), /3행: 최소 보유량/);
  assert.throws(() => parseCatalogCSV(csv(head, '원두,kg,100,5,0'), 'ingredient'), /2행: 발주 단위당 사용 수량은\(는\) 0보다 커야|2행: .*0보다 커야/);
  assert.throws(() => parseCatalogCSV(csv(head, '원두,kg,100,5,1', ' 원두 ,kg,100,5,1'), 'ingredient'), /3행: 재료 "원두"이\(가\) 파일 안에 두 번/);
  assert.throws(() => parseCatalogCSV(csv(head, '원두,kg,100,5'), 'ingredient'), /2행: 열 수가/);
  assert.throws(() => parseCatalogCSV(csv(head, ',kg,100,5,1'), 'ingredient'), /2행: 재료 이름을\(를\) 입력/);
});

test('header problems are explained', () => {
  assert.throws(() => parseCatalogCSV(csv('menu_name', '아메리카노'), 'menu'), /없는 열: price/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price,color', 'a,1,red'), 'menu'), /알 수 없는 열: color/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price,price', 'a,1,1'), 'menu'), /헤더/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price'), 'menu'), /등록할 행이 없습니다/);
  assert.throws(() => parseCatalogCSV('', 'menu'), /헤더/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price', '"열린따옴표,1'), 'menu'), /따옴표/);
});

test('menu CSV: category default, on-sale flags, duplicates', () => {
  const rows = parseCatalogCSV(csv('menu_name,category,price,is_on_sale', '아메리카노,커피,4500,Y', '단종,,3000,N', '신메뉴,베이커리,4200,'), 'menu');
  assert.deepEqual(rows.map((r) => [r.name, r.category, r.price, r.onSale]), [['아메리카노', '커피', 4500, true], ['단종', '기타', 3000, false], ['신메뉴', '베이커리', 4200, true]]);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price,is_on_sale', 'a,100,maybe'), 'menu'), /2행: 판매 여부/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price', 'a,100', 'A,200'), 'menu'), /3행: 메뉴 "A"이\(가\) 파일 안에 두 번/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price', 'a,1.5'), 'menu'), /정수/);
  assert.throws(() => parseCatalogCSV(csv('menu_name,price', 'a,-1'), 'menu'), /이상/);
});

test('recipe CSV: names must exist, quantities positive, no duplicate ingredient per menu', () => {
  const existing = { menus: [{ name: '카페라떼' }], ingredients: [{ name: '원두' }, { name: '우유' }] };
  const head = 'menu_name,ingredient_name,quantity';
  const rows = parseCatalogCSV(csv(head, '카페라떼,원두,0.018', ' 카페라떼 , 우유 ,0.2'), 'recipe', existing);
  assert.deepEqual(rows, [{ menu: '카페라떼', ingredient: '원두', qty: 0.018 }, { menu: '카페라떼', ingredient: '우유', qty: 0.2 }]);
  assert.throws(() => parseCatalogCSV(csv(head, '없는메뉴,원두,1'), 'recipe', existing), /2행: 메뉴 "없는메뉴"이\(가\) 등록돼 있지 않습니다/);
  assert.throws(() => parseCatalogCSV(csv(head, '카페라떼,설탕,1'), 'recipe', existing), /2행: 재료 "설탕"이\(가\) 등록돼 있지 않습니다/);
  assert.throws(() => parseCatalogCSV(csv(head, '카페라떼,원두,0'), 'recipe', existing), /2행: 소요량/);
  assert.throws(() => parseCatalogCSV(csv(head, '카페라떼,원두,1', '카페라떼,원두,2'), 'recipe', existing), /3행: 메뉴 "카페라떼"에 재료 "원두"이\(가\) 두 번/);
  // 이름 확인을 하지 않는 호출(서버가 다시 확인)
  assert.equal(parseCatalogCSV(csv(head, '아무거나,아무재료,1'), 'recipe').length, 1);
});

test('row limit and tokenizer', () => {
  const big = [CATALOG_SPEC.menu.sample[0].join(',')];
  for (let i = 0; i < 501; i++) big.push(`m${i},c,100,Y`);
  assert.throws(() => parseCatalogCSV(big.join(NL), 'menu'), /500행/);
  assert.deepEqual(csvRows('a,"b ""q"" c",d' + NL + NL + 'e,f,g' + NL), [['a', 'b "q" c', 'd'], ['e', 'f', 'g']]);
});

test('downloadable templates parse with their own headers', () => {
  for (const kind of ['ingredient', 'menu']) {
    const rows = parseCatalogCSV(templateCSV(kind), kind);
    assert.ok(rows.length >= 2);
  }
  const rows = parseCatalogCSV(templateCSV('recipe'), 'recipe');
  assert.equal(rows.length, 2);
});

test('menu CSV: sale_unit is optional and passed through', () => {
  const rows = parseCatalogCSV(csv('menu_name,category,price,sale_unit', '아메리카노,커피,4500,잔', '쿠키,디저트,3000,'), 'menu');
  assert.equal(rows[0].unit, '잔');
  assert.equal('unit' in rows[1], false);
});

test('ingredient CSV: only measurable units, case-normalized', () => {
  const head = 'ingredient_name,unit,unit_price,min_stock,order_quantity';
  const rows = parseCatalogCSV(csv(head, '시럽,l,19000,1,0.75', '소스,KG,19000,1,0.5', '우유,ml,3,1,1'), 'ingredient');
  assert.deepEqual(rows.map((r) => r.unit), ['L', 'kg', 'mL']);
  assert.throws(() => parseCatalogCSV(csv(head, '시럽,병,11000,2,1'), 'ingredient'), /1행|2행: 사용 단위는 kg, g, L, mL, 개/);
});
