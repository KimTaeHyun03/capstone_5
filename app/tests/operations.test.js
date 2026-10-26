import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesCSV,validateSales,summarizeSales,covers,availabilityFor,recipeCost,monday,addDays } from '../src/domain/operations.js';
const menus=[{id:1,onSale:true,price:4500},{id:2,onSale:true,price:5000},{id:3,onSale:false}];
const row={payment_no:'P1',menu_id:1,sold_at:'2026-01-01T09:00',quantity:2,amount:9000};
test('validated rows can be validated again (CSV preview -> save re-validates ISO strings with milliseconds)',()=>{
  const once=validateSales([{...row,sold_at:'2026-01-01T09:00:00+09:00'}],menus);
  assert.equal(once[0].sold_at,'2026-01-01T00:00:00.000Z');
  const twice=validateSales(once,menus);
  assert.deepEqual(twice,once);
});
test('CSV accepts menu_name instead of menu_id and rejects unknown names or both columns',()=>{
  const named=[{id:1,name:'아메리카노',onSale:true,price:4500},{id:2,name:'카페라떼',onSale:true,price:5000},{id:3,name:'단종',onSale:false}];
  const nl='\n';
  const rows=parseSalesCSV(['payment_no,menu_name,sold_at,quantity,amount','P1, 아메리카노 ,2026-01-01T09:00,2,9000','P2,카페라떼,2026-01-01T09:05,1,5000',''].join(nl));
  const out=validateSales(rows,named);
  assert.deepEqual(out.map(r=>r.menu_id),[1,2]);
  assert.throws(()=>validateSales([{...rows[0],menu_name:'없는메뉴'}],named),/찾을 수 없습니다/);
  assert.throws(()=>validateSales([{...rows[0],menu_name:'단종'}],named),/판매 중인 메뉴가 아닙니다/);
  assert.throws(()=>parseSalesCSV(['payment_no,menu_id,menu_name,sold_at,quantity,amount','P1,1,a,2026-01-01T09:00,1,1',''].join(nl)),/헤더/);
  assert.throws(()=>parseSalesCSV(['payment_no,sold_at,quantity,amount,extra','P1,2026-01-01T09:00,1,1,x',''].join(nl)),/헤더/);
});
test('CSV BOM, CRLF, quoted comma and escaped quote',()=>{
  const rows=parseSalesCSV('\uFEFFpayment_no,menu_id,sold_at,quantity,amount\r\n"P,""1""",1,2026-01-01T09:00,2,9000\r\n');
  assert.equal(rows[0].payment_no,'P,"1"');
  assert.equal(validateSales(rows,menus)[0].amount,9000);
  assert.throws(()=>parseSalesCSV('a,b\n1,2'),/헤더/);
  assert.throws(()=>parseSalesCSV('payment_no,menu_id,sold_at,quantity,amount\n"unclosed'),/따옴표/);
});
test('sales validation is atomic: duplicate, future, invalid date, unavailable menu, negative and fractional values',()=>{
  for(const change of [{quantity:1.5},{amount:-1},{menu_id:3},{sold_at:'2099-01-01T00:00'},{sold_at:'2026-02-30T09:00'},{sold_at:'2026-01-01T25:00'},{payment_no:''}])assert.throws(()=>validateSales([{...row,...change}],menus));
  assert.throws(()=>validateSales([row,row],menus),/동일 결제/);
  assert.throws(()=>validateSales([row],menus,[row]),/동일 결제/);
  assert.throws(()=>validateSales([row,{...row,menu_id:2,sold_at:'2026-01-01T10:00'}],menus),/판매일시/);
  assert.equal(validateSales([row],menus)[0].sold_at,'2026-01-01T00:00:00.000Z');
});
test('KST midnight boundary and multiple menu order counting',()=>{
  const sales=validateSales([row,{...row,menu_id:2,amount:5000},{...row,payment_no:'P2',sold_at:'2026-01-01T15:30:00Z',amount:100}],menus);
  const summary=summarizeSales(sales);
  assert.deepEqual(summary.map(r=>[r.base_date,r.time_slot,r.sales_amount,r.order_count]),[['2026-01-01',9,14000,1],['2026-01-02',0,100,1]]);
});
test('availability joins adjacent or overlapping intervals but never bridges a gap',()=>{
  assert.equal(covers([[8,10],[10,12]],8,12),true);
  assert.equal(covers([[8,10],[11,12]],8,12),false);
  assert.equal(covers([[8,12],[9,11]],8,12),true);
  const rows=[{user_id:1,day_of_week:0,target_week:'2026-01-05',start_time:'08:30:00',end_time:'12:00:00'}];
  assert.deepEqual(availabilityFor(rows,1,0,'2026-01-05'),[[8.5,12]]);
  assert.deepEqual(availabilityFor(rows,1,0,'2026-01-12'),[]);
});
test('recipe cost uses current ingredient price, dates cross year boundary',()=>{
  assert.equal(recipeCost([['1',0.2]],[{id:1,price:2400}]),480);
  assert.equal(monday('2026-01-01'),'2025-12-29');
  assert.equal(addDays('2025-12-29',7),'2026-01-05');
});
