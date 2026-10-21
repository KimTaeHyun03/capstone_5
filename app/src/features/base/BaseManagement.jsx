import { useState } from 'react';
import { Alert, Badge, Button, Field, Modal, PageHead, Panel } from '../../components/ui/index.jsx';
import { recipeCost } from '../../domain/operations.js';
import { won } from '../../domain/index.js';
import { useApp } from '../../state/AppState.jsx';
import { DataNotice, DeleteButton, Editor, ErrorText, useAction } from './OperationsUI.jsx';

export function StorePage() {
  const {ops}=useApp(), {store,staff}=ops;
  const [edit,setEdit]=useState(null), action=useAction();
  const employees=staff.filter(s=>s.role!=='점주');
  const fresh={name:'',email:'',phone:'',role:'알바생',wage:10320,maxHours:20,status:'초대됨'};
  return <><PageHead eyebrow="기초 정보 · 7-1" title="매장·직원" desc="직원 정보 저장 후 이메일 초대를 발송할 수 있습니다." actions={<Button onClick={()=>setEdit({kind:'staff',data:fresh})}>직원 등록</Button>}/><div className="stack-lg"><DataNotice/><ErrorText error={action.error}/>
    <Panel title="매장 정보" actions={<Button variant="secondary" onClick={()=>setEdit({kind:'store',data:store})}>수정</Button>}>
      <dl className="kv"><dt>매장명</dt><dd>{store.name}</dd><dt>주소</dt><dd>{store.address||'—'}</dd><dt>전화</dt><dd>{store.phone||'—'}</dd><dt>영업시간</dt><dd>{store.open}–{store.close}</dd></dl>
    </Panel>
    <Panel title="직원 계정" meta={`${employees.length}명`}><div className="table-wrap"><table><thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>시급</th><th>주 최대</th><th>상태</th><th>관리</th></tr></thead><tbody>
      {employees.map(s=><tr key={s.id}><th>{s.name}</th><td>{s.email||'미등록'}</td><td>{s.role}</td><td>{won(s.wage)}</td><td>{s.maxHours}시간</td><td><Badge tone={s.status==='활성'?'green':'orange'}>{s.status}</Badge></td><td><div className="od-cluster"><Button variant="text" onClick={()=>setEdit({kind:'staff',data:s})}>수정</Button>{!s.linked&&<Button variant="text" disabled={action.busy||!s.email||ops.mode==='demo'} onClick={()=>action.run(()=>ops.invite(s.id),'초대 이메일을 발송했습니다.')}>이메일 초대</Button>}<DeleteButton label={s.name} onDelete={()=>ops.save('staff',s,true)}/></div></td></tr>)}
      {!employees.length&&<tr><td colSpan={7}>등록된 직원이 없습니다.</td></tr>}</tbody></table></div><p className="help">로그인과 연결된 직원은 삭제 대신 비활성으로 변경합니다. 체험 모드에서는 초대 메일을 보내지 않습니다.</p></Panel>
    </div>{edit&&<Editor title={edit.kind==='store'?'매장 수정':'직원 정보'} initial={edit.data} onClose={()=>setEdit(null)} onSave={f=>ops.save(edit.kind,f)} fields={edit.kind==='store'?[
      {key:'name',label:'매장명',required:true},{key:'address',label:'주소'},{key:'phone',label:'전화번호'},{key:'open',label:'영업 시작',type:'time'},{key:'close',label:'영업 종료',type:'time'}
    ]:[{key:'name',label:'이름',required:true},{key:'email',label:'초대 이메일',type:'email',required:true,disabled:edit.data.linked},{key:'phone',label:'전화번호',type:'tel'},{key:'role',label:'역할',options:['알바생','매니저']},{key:'wage',label:'시급(원)',type:'number'},{key:'maxHours',label:'주 최대 근무시간',type:'number'},{key:'status',label:'상태',options:['초대됨','활성','비활성']} ]}/>}</>;
}
export function MenuPage() {
  const {ops}=useApp(),{menus,recipes,ingredients}=ops;
  const [edit,setEdit]=useState(null),[recipe,setRecipe]=useState(null);
  const missing=menus.filter(m=>!recipes[m.id]?.length);
  return <><PageHead eyebrow="기초 정보 · 7-2 · 7-4" title="메뉴·레시피" desc="재료 단가와 1개당 소요량으로 메뉴 원가를 계산합니다." actions={<Button onClick={()=>setEdit({name:'',category:'커피',price:0,onSale:true})}>메뉴 추가</Button>}/><div className="stack-lg"><DataNotice/>
    {!!missing.length&&<Alert tone="warning" title={`레시피 미등록 ${missing.length}개`}>{missing.map(m=>m.name).join(', ')} — 재고 자동 차감에 필요한 레시피를 등록하세요.</Alert>}
    <Panel title="메뉴 목록"><div className="table-wrap"><table><thead><tr><th>메뉴 / ID</th><th>분류</th><th>판매가</th><th>원가</th><th>원가율</th><th>판매</th><th>관리</th></tr></thead><tbody>{menus.map(m=>{
      const cost=recipeCost(recipes[m.id]||[],ingredients),has=!!recipes[m.id]?.length;
      return <tr key={m.id}><th>{m.name}<small className="help">{m.id}</small></th><td>{m.category}</td><td>{won(m.price)}</td><td>{has?won(cost):'—'}</td><td>{has&&m.price>0?`${(cost/m.price*100).toFixed(1)}%`:'—'}</td><td>{m.onSale?'판매 중':'판매 중지'}</td><td><div className="od-cluster"><Button variant="text" onClick={()=>setEdit(m)}>수정</Button><Button variant="text" onClick={()=>setRecipe(m)}>레시피 {recipes[m.id]?.length||0}개</Button><DeleteButton label={m.name} onDelete={()=>ops.save('menu',m,true)}/></div></td></tr>;
    })}{!menus.length&&<tr><td colSpan={7}>등록된 메뉴가 없습니다.</td></tr>}</tbody></table></div></Panel></div>
    {edit&&<Editor title={edit.id?'메뉴 수정':'메뉴 추가'} initial={edit} onClose={()=>setEdit(null)} onSave={f=>ops.save('menu',f)} fields={[{key:'name',label:'메뉴명',required:true},{key:'category',label:'분류'},{key:'price',label:'판매가(원)',type:'number'},{key:'onSale',label:'판매 중',type:'checkbox'}]}/>}
    {recipe&&<RecipeEditor menu={recipe} onClose={()=>setRecipe(null)}/>}</>;
}
function RecipeEditor({menu,onClose}) {
  const {ops}=useApp(),action=useAction();
  const [lines,setLines]=useState((ops.recipes[menu.id]||[]).map(([id,qty])=>[String(id),qty]));
  const change=(index,col,value)=>setLines(ls=>ls.map((l,i)=>i===index?l.map((v,c)=>c===col?value:v):l));
  return <Modal title={`${menu.name} 레시피`} desc="재료 사용 단위 기준, 메뉴 1개당 소요량입니다. 모든 행을 지워 저장하면 레시피가 삭제됩니다." onClose={()=>!action.busy&&onClose()} footer={<><Button variant="secondary" disabled={action.busy} onClick={onClose}>취소</Button><Button disabled={action.busy} onClick={()=>action.run(()=>ops.save('recipe',{id:menu.id,lines}),'레시피를 저장했습니다.',onClose)}>저장</Button></>}>
    <div className="stack-md"><ErrorText error={action.error}/>{lines.map(([id,qty],index)=><div className="od-row" key={index}><Field id={`ri-${index}`} label={`재료 ${index+1}`}><select className="select" id={`ri-${index}`} value={id} onChange={e=>change(index,0,e.target.value)}><option value="">선택</option>{ops.ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></Field><Field id={`rq-${index}`} label="소요량"><input className="input" id={`rq-${index}`} type="number" min="0.001" step="0.001" value={qty} onChange={e=>change(index,1,e.target.value)}/></Field><Button variant="text" onClick={()=>setLines(ls=>ls.filter((_,i)=>i!==index))}>행 삭제</Button></div>)}<Button variant="secondary" disabled={!ops.ingredients.length} onClick={()=>setLines(ls=>[...ls,['',1]])}>재료 추가</Button><p>원가 합계: {won(recipeCost(lines,ops.ingredients))}</p>{!ops.ingredients.length&&<p>재료를 먼저 등록하세요.</p>}</div>
  </Modal>;
}
export function IngredientPage() {
  const {ops}=useApp(),[edit,setEdit]=useState(null);
  return <><PageHead eyebrow="기초 정보 · 7-3" title="재료" desc="재료를 추가하면 수량 0의 재고 항목이 함께 생성됩니다." actions={<Button onClick={()=>setEdit({name:'',unit:'개',price:0,min:0,orderUnit:1,orderLabel:'',supplier:''})}>재료 추가</Button>}/><div className="stack-lg"><DataNotice/><Panel title="재료 목록"><div className="table-wrap"><table><thead><tr><th>재료</th><th>단위</th><th>단가</th><th>최소 보유</th><th>발주 수량</th><th>거래처</th><th>관리</th></tr></thead><tbody>{ops.ingredients.map(i=><tr key={i.id}><th>{i.name}</th><td>{i.unit}</td><td>{won(i.price)}</td><td>{i.min}{i.unit}</td><td>{i.orderUnit}{i.unit}</td><td>{i.supplier||'—'}</td><td><Button variant="text" onClick={()=>setEdit(i)}>수정</Button><DeleteButton label={i.name} onDelete={()=>ops.save('ingredient',i,true)}/></td></tr>)}{!ops.ingredients.length&&<tr><td colSpan={7}>등록된 재료가 없습니다.</td></tr>}</tbody></table></div></Panel></div>
    {edit&&<Editor title={edit.id?'재료 수정':'재료 추가'} initial={edit} onClose={()=>setEdit(null)} onSave={f=>ops.save('ingredient',f)} fields={[{key:'name',label:'재료명',required:true},{key:'unit',label:'사용 단위 (kg, L, 개 등)',required:true},{key:'price',label:'사용 단위당 단가(원)',type:'number'},{key:'min',label:'최소 보유량',type:'number',step:'0.01'},{key:'orderUnit',label:'1회 발주 단위당 사용 수량',type:'number',step:'0.001'},{key:'orderLabel',label:'발주 단위명 (예: 12L 묶음)'},{key:'supplier',label:'거래처'}]}/>}</>;
}
