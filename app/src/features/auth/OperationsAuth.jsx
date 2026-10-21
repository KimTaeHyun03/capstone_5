import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, PageHead } from '../../components/ui/index.jsx';
import { useApp } from '../../state/AppState.jsx';
import { ErrorText, useAction } from '../base/OperationsUI.jsx';
const paths={'점주':'/owner/sales/records','매니저':'/manager/availability','알바생':'/staff/availability'};
export function LoginPage() {
  const {ops}=useApp(),action=useAction(),navigate=useNavigate();
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  return <main className="entry"><div className="entry-inner stack-lg"><PageHead title="카페 온기 운영 관리" desc="매장 계정으로 로그인하거나 로컬 체험을 시작하세요."/>
    <ErrorText error={action.error||ops.error}/>
    {ops.configured?<section className="panel stack-md">
      {ops.session?<><p>로그인되어 있습니다.</p>{ops.profile&&<Button to={paths[ops.profile.role]}>내 매장으로</Button>}<Button disabled={action.busy} variant="secondary" onClick={()=>action.run(ops.signOut,'로그아웃했습니다.')}>로그아웃</Button><Field id="new-password" label="초대 수락 후 비밀번호 설정 (8자 이상)"><input id="new-password" className="input" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field><Button disabled={action.busy} onClick={()=>action.run(async()=>{if(password.length<8)throw new Error('8자 이상으로 입력하세요.');await ops.changePassword(password);setPassword('');},'비밀번호를 설정했습니다.')}>비밀번호 저장</Button></>:
      <form className="stack-md" onSubmit={e=>{e.preventDefault();action.run(()=>ops.signIn(email,password),'로그인했습니다.');}}><Field id="login-email" label="이메일"><input id="login-email" className="input" type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field id="login-password" label="비밀번호"><input id="login-password" className="input" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></Field><button type="submit" className="btn btn-primary" disabled={action.busy||!ops.ready}>로그인</button></form>}
      {ops.mode==='demo'&&<Button variant="secondary" onClick={ops.startLive}>실제 DB 모드로 전환</Button>}
      {ops.loading&&<p role="status">계정 정보를 확인하고 있습니다…</p>}
      {ops.error&&<Button onClick={ops.refresh}>계정 정보 다시 확인</Button>}
    </section>:<Alert title="로컬 체험 모드">Supabase 환경변수가 없습니다. 아래 체험 데이터는 현재 브라우저에 저장됩니다.</Alert>}
    <section className="panel stack-md"><h2>로컬 체험</h2><p>DB에 전송하지 않는 예시 데이터입니다. 8~10단계에서 저장한 내용은 새로고침 후에도 유지됩니다.</p><div className="od-cluster">{[['점주','/owner/sales/records'],['매니저','/manager/availability'],['알바생','/staff/availability']].map(([role,path])=><Button key={role} variant="secondary" onClick={()=>{ops.startDemo();navigate(path);}}>{role} 체험</Button>)}</div></section>
  </div></main>;
}
export function RouteGate({role,children}) {
  const {ops}=useApp(),{pathname}=useLocation();
  if(ops.mode==='demo')return children;
  if(!ops.ready)return <p role="status">로그인 확인 중…</p>;
  if(!ops.session)return <Navigate to="/" replace/>;
  if(ops.error)return <div className="panel"><ErrorText error={ops.error}/><Button onClick={ops.refresh}>다시 시도</Button><Button to="/">로그인 화면</Button></div>;
  if(!ops.profile)return <p role="status">매장 정보 조회 중…</p>;
  if(ops.profile.role!==role)return <Navigate to={paths[ops.profile.role]||'/'} replace/>;
  const implemented=['/owner/sales/records','/owner/sales/status','/owner/work/availability','/owner/base/store','/owner/base/menu','/owner/base/ingredient','/manager/availability','/manager/my-availability','/staff/availability'];
  if(!implemented.includes(pathname))return <div className="panel stack-md"><Alert title="이 화면은 아직 예시 데이터 단계입니다">실제 DB 연결은 판매 기록·매출 집계·가능시간·기초 정보 화면에 적용되어 있습니다.</Alert><Button to={paths[role]}>구현된 화면으로 이동</Button><Button to="/">로그인·체험 선택</Button></div>;
  return children;
}
