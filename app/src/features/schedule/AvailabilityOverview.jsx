import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, PageHead, Panel } from '../../components/ui/index.jsx';
import { DAYS, SHIFTS } from '../../domain/constants.js';
import { addDays, availabilityFor, covers, monday } from '../../domain/operations.js';
import { useApp } from '../../state/AppState.jsx';
import { DataNotice, ErrorText, useAction } from '../base/OperationsUI.jsx';
export function WeekPicker() {
  const {ops}=useApp();
  return <div className="od-cluster"><Button variant="secondary" onClick={()=>ops.setWeek(addDays(ops.week,-7))}>이전 주</Button><Field id="availability-week" label="조회 주차"><input id="availability-week" className="input" type="date" value={ops.week} onChange={e=>e.target.value&&ops.setWeek(monday(e.target.value))}/></Field><Button variant="secondary" onClick={()=>ops.setWeek(addDays(ops.week,7))}>다음 주</Button><span>{ops.week} ~ {addDays(ops.week,6)}</span></div>;
}
const showTime=v=>`${String(Math.floor(v)).padStart(2,'0')}:${String(Math.round(v%1*60)).padStart(2,'0')}`;
export function AvailabilityOverview() {
  const {ops}=useApp();
  const staff=ops.staff.filter(s=>s.role!=='점주'&&s.status==='활성');
  const submitted=s=>s.availability_week===ops.week || ops.availability.some(a=>String(a.user_id)===String(s.id)&&a.target_week===ops.week);
  const missing=staff.filter(s=>!submitted(s));
  let zero=0;
  const counts=SHIFTS.map(shift=>DAYS.map((_,day)=>{
    const candidates=staff.filter(s=>submitted(s)&&covers(availabilityFor(ops.availability,s.id,day,ops.week),shift.start,shift.end));
    if(!candidates.length)zero++;
    const forecasts=ops.forecast.filter(f=>f.target_week===ops.week&&f.day_of_week===day&&f.time_slot>=shift.start&&f.time_slot<shift.end);
    const need=forecasts.length>0&&forecasts.every(f=>f.required_staff!=null)?Math.max(...forecasts.map(f=>f.required_staff)):null;
    return {candidates,need};
  }));
  return <><PageHead eyebrow="근무 관리" title="가능시간 현황" desc="해당 주차에 제출한 활성 직원만 집계합니다. 여러 구간은 실제로 이어지는 경우에만 한 시프트를 지원한 것으로 계산합니다."/><div className="stack-lg"><DataNotice/><WeekPicker/><Button variant="text" onClick={ops.refresh} disabled={ops.loading}>최신 제출 내역 새로고침</Button>
    {!!missing.length&&<Alert tone="warning" title={`미제출 ${missing.length}명`}>{missing.map(s=>s.name).join(', ')} 님이 아직 가능시간을 제출하지 않았습니다.</Alert>}
    {!!zero&&<Alert tone="warning" title={`지원 인원 0명인 시프트 ${zero}개`}>아래 집계에서 빈 시간대를 확인하세요.</Alert>}
    <Panel title="직원별 가능시간" meta={`활성 ${staff.length}명 · 제출 ${staff.length-missing.length}명`}><div className="table-wrap"><table><thead><tr><th>직원</th>{DAYS.map((d,i)=><th key={d}>{d}<br/>{addDays(ops.week,i).slice(5)}</th>)}</tr></thead><tbody>{staff.map(s=><tr key={s.id}><th>{s.name}<small className="help">주 {s.maxHours}시간</small></th>{DAYS.map((d,i)=>{const intervals=availabilityFor(ops.availability,s.id,i,ops.week);return <td key={d}>{!submitted(s)?'미제출':intervals.length?intervals.map(([a,b])=>`${showTime(a)}–${showTime(b)}`).join(', '):'불가'}</td>;})}</tr>)}{!staff.length&&<tr><td colSpan={8}>활성 직원이 없습니다.</td></tr>}</tbody></table></div></Panel>
    <Panel title="시프트별 지원 인원 / 필요 인원"><div className="table-wrap"><table><thead><tr><th>시프트</th>{DAYS.map(d=><th key={d}>{d}</th>)}</tr></thead><tbody>{SHIFTS.map((s,si)=><tr key={s.id}><th>{s.label} {s.start}–{s.end}</th>{counts[si].map(({candidates,need},di)=><td key={di} title={candidates.map(s=>s.name).join(', ')||'지원자 없음'}><Badge tone={!candidates.length||(need!==null&&candidates.length<need)?'red':'green'}>{candidates.length} / {need??'미산출'}</Badge></td>)}</tr>)}</tbody></table></div><p className="help">필요 인원은 해당 주차 매출 예측의 시프트 내 최대값입니다. 예측이 없으면 미산출로 표시합니다. 지원자 수는 최종 배정 인원이 아닙니다.</p></Panel></div></>;
}
export function AvailabilityEditor() {
  const {ops}=useApp(),action=useAction();
  const [selected,setSelected]=useState({}),[max,setMax]=useState(20);
  useEffect(()=>{
    setMax(ops.me?.maxHours??20);
    setSelected(Object.fromEntries(DAYS.map((_,d)=>[d,SHIFTS.map(s=>covers(availabilityFor(ops.availability,ops.me?.id,d,ops.week),s.start,s.end))])));
  },[ops.week,ops.availability,ops.me?.id,ops.me?.maxHours]);
  const save=()=>action.run(()=>ops.saveAvailability(DAYS.flatMap((_,d)=>SHIFTS.filter((s,i)=>selected[d]?.[i]).map(s=>({day_of_week:d,start_time:`${String(s.start).padStart(2,'0')}:00`,end_time:`${String(s.end).padStart(2,'0')}:00`}))),max),'가능시간을 저장했습니다.');
  return <div className="stack-lg"><PageHead title="가능시간 등록" desc="선택하지 않은 시간은 불가입니다. 모두 해제하고 제출하면 이번 주 근무 불가로 등록됩니다."/><DataNotice/><WeekPicker/><ErrorText error={action.error}/><div className="toggle-grid"><span/>{SHIFTS.map(s=><span key={s.id}>{s.label} {s.start}–{s.end}</span>)}{DAYS.map((d,di)=><div key={d} style={{display:'contents'}}><strong>{d}</strong>{SHIFTS.map((s,si)=><button type="button" key={s.id} className="slot-btn" aria-label={`${d}요일 ${s.label}`} aria-pressed={!!selected[di]?.[si]} onClick={()=>setSelected(p=>({...p,[di]:SHIFTS.map((_,i)=>i===si?!p[di]?.[i]:!!p[di]?.[i])}))}>{selected[di]?.[si]?'가능':'불가'}</button>)}</div>)}</div><Field id="avail-max" label="주 최대 근무시간"><input id="avail-max" className="input" type="number" value={max} onChange={e=>setMax(e.target.value)}/></Field><Button disabled={action.busy||ops.loading||!ops.me} onClick={save}>가능시간 저장</Button></div>;
}
