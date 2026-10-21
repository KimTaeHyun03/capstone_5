import { useRef, useState } from 'react';
import { Alert, Button, Field, Modal, useToast } from '../../components/ui/index.jsx';
import { useApp } from '../../state/AppState.jsx';
export function DataNotice() {
  const {ops}=useApp();
  return <>{ops.mode==='demo' && <Alert title="로컬 체험 데이터">이 브라우저에 저장됩니다. 실제 매장 DB 저장·이메일 발송은 로그인 후 사용할 수 있습니다.</Alert>}{ops.loading && <p role="status">매장 데이터를 불러오는 중입니다…</p>}{ops.error && <Alert tone="danger" title="데이터를 불러오지 못했습니다" action={<Button onClick={ops.refresh}>다시 시도</Button>}>{ops.error}</Alert>}</>;
}
export function useAction() {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const running=useRef(false), toast=useToast();
  const run=async(fn,message,onSuccess)=>{
    if(running.current) return;
    running.current=true;setBusy(true);setError('');
    try {const result=await fn();if(message)toast(message);onSuccess?.(result);return true;}
    catch(e){setError(e.message || '작업을 완료하지 못했습니다.');return false;}
    finally{running.current=false;setBusy(false);}
  };
  return {busy,error,run,clear:()=>setError('')};
}
export const ErrorText=({error})=>error?<div role="alert"><Alert tone="danger" title={error}/></div>:null;
export function Editor({title,initial,fields,onSave,onClose}) {
  const [form,setForm]=useState(initial), action=useAction();
  return <Modal title={title} onClose={()=>!action.busy&&onClose()} footer={<><Button variant="secondary" disabled={action.busy} onClick={onClose}>취소</Button><Button disabled={action.busy} onClick={()=>action.run(()=>onSave(form),'저장했습니다.',onClose)}>{action.busy?'저장 중…':'저장'}</Button></>}>
    <div className="stack-md"><ErrorText error={action.error}/>{fields.map(f=><Field key={f.key} id={`edit-${f.key}`} label={f.label} required={f.required} help={f.help}>
      {f.options?<select id={`edit-${f.key}`} className="select" value={form[f.key]??''} onChange={e=>setForm({...form,[f.key]:e.target.value})}>{f.options.map(o=><option key={o}>{o}</option>)}</select>:
      f.type==='checkbox'?<input id={`edit-${f.key}`} type="checkbox" checked={!!form[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.checked})}/>:
      <input id={`edit-${f.key}`} className="input" type={f.type||'text'} step={f.step||'any'} value={form[f.key]??''} disabled={f.disabled} maxLength={f.maxLength} onChange={e=>setForm({...form,[f.key]:e.target.value})}/>}</Field>)}</div>
  </Modal>;
}
export function DeleteButton({onDelete,label}) {
  const [open,setOpen]=useState(false),action=useAction();
  return <><Button variant="text" onClick={()=>setOpen(true)}>삭제</Button>{open&&<Modal title={`${label} 삭제`} desc="삭제 후 복구할 수 없습니다. 연결된 이력이 있으면 삭제가 차단됩니다." onClose={()=>!action.busy&&setOpen(false)} footer={<><Button variant="secondary" disabled={action.busy} onClick={()=>setOpen(false)}>취소</Button><Button disabled={action.busy} onClick={()=>action.run(onDelete,'삭제했습니다.',()=>setOpen(false))}>삭제 확인</Button></>}><ErrorText error={action.error}/></Modal>}</>;
}
