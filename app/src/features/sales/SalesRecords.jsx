import { useState } from 'react';
import { Alert, Button, Field, PageHead, Pagination, Panel, StatCard, usePaged } from '../../components/ui/index.jsx';
import { dateKST, parseSalesCSV, validateSales } from '../../domain/operations.js';
import { won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { DataNotice, ErrorText, useAction } from '../base/OperationsUI.jsx';

const newForm=()=>({payment_no:`M-${crypto.randomUUID().slice(0,20)}`,menu_id:'',sold_at:new Date(Date.now()+9*3600000).toISOString().slice(0,16),quantity:'1',amount:''});
export function SalesRecords() {
  const {ops}=useApp(),action=useAction(),fileAction=useAction();
  const [form,setForm]=useState(newForm),[preview,setPreview]=useState([]);
  const menuName=id=>ops.menus.find(m=>String(m.id)===String(id))?.name||id;
  const update=(key,value)=>setForm(f=>{
    const next={...f,[key]:value};
    if(key==='menu_id'||key==='quantity') {const m=ops.menus.find(m=>String(m.id)===String(next.menu_id)); if(m)next.amount=String(m.price*Number(next.quantity));}
    return next;
  });
  const readFile=async e=>{
    const file=e.target.files?.[0];e.target.value='';setPreview([]);if(!file)return;
    await fileAction.run(async()=>{if(file.size>2*1024*1024)throw new Error('CSV는 2MB 이하여야 합니다.');const parsed=parseSalesCSV(await file.text());setPreview(validateSales(parsed,ops.menus,ops.sales));});
  };
  const download=()=>{
    const first=ops.menus.find(m=>m.onSale);
    const text=`\uFEFFpayment_no,menu_id,sold_at,quantity,amount\r\nEXAMPLE-${Date.now()},${first?.id||'메뉴ID'},${dateKST()}T08:00:00+09:00,1,${first?.price||4500}\r\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='판매기록_양식.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const records=ops.sales.filter(s=>{const d=dateKST(new Date(s.sold_at));return d>=ops.range.from&&d<=ops.range.to;}).sort((a,b)=>b.sold_at.localeCompare(a.sold_at));
  const paged=usePaged(records,20);
  return <><PageHead eyebrow="매출 분석 · 1-1" title="판매 기록" desc="POS 연동 전 임시 수집 방식입니다. 판매 일시는 한국 시간 기준, 금액은 할인 등을 반영한 실제 결제 금액입니다."/>
    <div className="stack-lg"><DataNotice/><ErrorText error={action.error}/>
    <Panel title="판매 직접 입력"><div className="grid-3">
      <Field id="sale-payment" label="결제번호"><input id="sale-payment" className="input" value={form.payment_no} maxLength={30} onChange={e=>update('payment_no',e.target.value)}/></Field>
      <Field id="sale-menu" label="메뉴"><select id="sale-menu" className="select" value={form.menu_id} onChange={e=>update('menu_id',e.target.value)}><option value="">선택하세요</option>{ops.menus.filter(m=>m.onSale).map(m=><option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}</select></Field>
      <Field id="sale-at" label="판매 일시 (한국 시간)"><input id="sale-at" className="input" type="datetime-local" value={form.sold_at} onChange={e=>update('sold_at',e.target.value)}/></Field>
      <Field id="sale-qty" label="수량"><input id="sale-qty" className="input" type="number" min="1" step="1" value={form.quantity} onChange={e=>update('quantity',e.target.value)}/></Field>
      <Field id="sale-amount" label="결제 금액(원)"><input id="sale-amount" className="input" type="number" min="0" step="1" value={form.amount} onChange={e=>update('amount',e.target.value)}/></Field>
    </div><Button disabled={action.busy||ops.loading} onClick={()=>action.run(()=>ops.importSales([form]),'판매 기록과 매출 집계를 저장했습니다.',()=>setForm(newForm()))}>{action.busy?'저장 중…':'판매 저장'}</Button></Panel>
    <Panel title="CSV 업로드" actions={<Button variant="secondary" onClick={download}>양식 다운로드</Button>}>
      <p className="help">UTF-8 CSV · 최대 1,000행 / 2MB · 헤더: payment_no,menu_name(또는 menu_id),sold_at,quantity,amount. 메뉴는 등록한 이름으로 써도 됩니다. 같은 결제번호·메뉴는 한 행으로 합치세요. 기존 결제와 중복되면 전체 저장이 취소됩니다.</p>
      <Field id="sale-file" label="CSV 파일 선택"><input id="sale-file" type="file" accept=".csv,text/csv" disabled={action.busy||fileAction.busy} onChange={readFile}/></Field><ErrorText error={fileAction.error}/>
      {!!preview.length&&<><Alert title={`${preview.length}행 검증 완료 · ${won(preview.reduce((n,r)=>n+r.amount,0))}`}>미리보기는 최대 10행입니다. 아래 저장 버튼을 눌러야 DB 또는 로컬 체험 데이터에 반영됩니다.</Alert><div className="table-wrap"><table><thead><tr><th>결제번호</th><th>메뉴</th><th>수량</th><th>금액</th></tr></thead><tbody>{preview.slice(0,10).map((r,i)=><tr key={i}><td>{r.payment_no}</td><td>{menuName(r.menu_id)}</td><td>{r.quantity}</td><td>{won(r.amount)}</td></tr>)}</tbody></table></div><Button disabled={action.busy||ops.loading} onClick={()=>action.run(()=>ops.importSales(preview),`${preview.length}행을 저장했습니다.`,()=>setPreview([]))}>검증한 {preview.length}행 저장</Button></>}
    </Panel>
    <SalesSummary/>
    <Panel title="판매 내역" meta={`${records.length}행`}><div className="table-wrap"><table><thead><tr><th>판매 일시</th><th>결제번호</th><th>메뉴</th><th>수량</th><th>금액</th></tr></thead><tbody>{paged.rows.map(r=><tr key={r.sale_id}><td>{new Date(r.sold_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</td><td>{r.payment_no}</td><td>{menuName(r.menu_id)}</td><td>{r.quantity}</td><td>{won(r.amount)}</td></tr>)}{!records.length&&<tr><td colSpan={5}>선택한 기간의 판매 기록이 없습니다.</td></tr>}</tbody></table></div><Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={records.length}/></Panel>
    </div></>;
}
export function SalesSummary({standalone=false}) {
  const {ops}=useApp(),action=useAction();
  const [dates,setDates]=useState(ops.range);
  const latestFirst=[...ops.summary].sort((a,b)=>b.base_date.localeCompare(a.base_date)||b.time_slot-a.time_slot);
  const paged=usePaged(latestFirst,20);
  const total=ops.summary.reduce((n,r)=>n+r.sales_amount,0),orders=ops.summary.reduce((n,r)=>n+r.order_count,0);
  const apply=()=>action.run(async()=>{if(!dates.from||!dates.to||dates.to<dates.from||(new Date(dates.to)-new Date(dates.from))/86400000>93)throw new Error('조회 기간은 1~94일로 선택하세요.');ops.setRange(dates);});
  return <>{standalone&&<><PageHead eyebrow="매출 분석 · 1-2" title="매출 현황" desc="판매 기록이 반영된 날짜·시간대별 집계입니다." actions={<Button to="/owner/sales/records">판매 입력</Button>}/><DataNotice/></>}<Panel title="조회 기간 · 매출 집계"><div className="od-cluster"><Field id="sales-from" label="시작일"><input id="sales-from" className="input" type="date" value={dates.from} onChange={e=>setDates({...dates,from:e.target.value})}/></Field><Field id="sales-to" label="종료일"><input id="sales-to" className="input" type="date" value={dates.to} onChange={e=>setDates({...dates,to:e.target.value})}/></Field><Button disabled={ops.loading} onClick={apply}>기간 조회</Button></div><ErrorText error={action.error}/><p className="help">현재 조회: {ops.range.from} ~ {ops.range.to}</p><div className="grid-3"><StatCard label="매출액" value={won(total)}/><StatCard label="주문 수" value={orders} unit="건"/><StatCard label="주문당 매출" value={won(orders?total/orders:0)}/></div><div className="table-wrap"><table><thead><tr><th>날짜</th><th>요일</th><th>시간대</th><th>매출</th><th>주문</th></tr></thead><tbody>{paged.rows.map(r=><tr key={`${r.base_date}-${r.time_slot}`}><td>{r.base_date}</td><td>{['월','화','수','목','금','토','일'][r.day_of_week]}</td><td>{r.time_slot}시</td><td>{won(r.sales_amount)}</td><td>{r.order_count}건</td></tr>)}{!ops.summary.length&&<tr><td colSpan={5}>집계된 판매가 없습니다.</td></tr>}</tbody></table></div><Pagination page={paged.page} pages={paged.pages} onPage={paged.setPage} total={ops.summary.length}/></Panel></>;
}
