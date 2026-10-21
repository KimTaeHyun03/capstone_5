import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert, Badge, Button, Field } from '../../components/ui/index.jsx';
import { BrandMark } from '../../layouts/Layouts.jsx';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_HOME, useAuth } from '../../lib/auth.jsx';

export default function EntryPage() {
  const { demo, loading, session, account } = useAuth();
  useEffect(() => { document.title = '로그인 · 카페 온기 운영 관리'; }, []);

  if (account) return <Navigate to={ROLE_HOME[account.role] || '/'} replace />;

  return (
    <main className="entry">
      <div className="entry-inner">
        <div className="entry-brand">
          <BrandMark />
          <h1 className="entry-title">감이 아니라 데이터로<br />발주하고 근무표 짜기</h1>
          <p className="entry-desc">매장의 매출 패턴으로 다음 주 필요 인원과 재료 발주량을 계산합니다. 매장에서 받은 계정으로 로그인하세요.</p>
        </div>
        <div className="login-row">
          {loading ? <p className="auth-loading" role="status">계정을 확인하는 중…</p> : session && !demo ? <NotLinked /> : <LoginForm />}
          {demo && <DemoAccounts />}
        </div>
        <p className="entry-foot">계정이 없으면 점주에게 직원 계정 등록을 요청하세요.</p>
      </div>
    </main>
  );
}

// 체험 모드 안내 — Supabase Auth 가 아니라 브라우저 안에서만 확인하는 테스트 계정
function DemoAccounts() {
  return (
    <aside className="login-card login-demo" aria-labelledby="demo-title">
      <h2 className="login-title" id="demo-title"><Badge tone="orange">체험 모드</Badge> 테스트 계정</h2>
      <p className="help">DB 마이그레이션 적용 전 화면 확인용입니다. 실제 Supabase 로그인이 아니며, 비밀번호는 모두 <strong>{DEMO_PASSWORD}</strong>입니다.</p>
      <ul className="demo-accounts">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email}><span>{a.role} · {a.name}</span><code>{a.email}</code></li>
        ))}
      </ul>
    </aside>
  );
}

function LoginForm() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!email.trim()) next.email = '이메일을 입력하세요.';
    if (!password) next.password = '비밀번호를 입력하세요.';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const msg = await signIn(email.trim(), password);
    setBusy(false);
    if (msg) setFailure(msg);
  };

  return (
    <form className="login-card" onSubmit={submit} noValidate>
      <h2 className="login-title">로그인</h2>
      {failure && <Alert tone="danger" title={failure} live />}
      <Field id="login-email" label="이메일" required error={errors.email}>
        <input id="login-email" className="input" type="email" autoComplete="username" value={email}
          onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'login-email-err' : undefined} />
      </Field>
      <Field id="login-pw" label="비밀번호" required error={errors.password}>
        <input id="login-pw" className="input" type="password" autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'login-pw-err' : undefined} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
    </form>
  );
}

// 인증은 됐지만 매장 계정(user_account)에 연결되지 않았거나 비활성인 경우
function NotLinked() {
  const { session, signOut } = useAuth();
  return (
    <div className="login-card">
      <Alert tone="warning" title="매장 계정에 연결되지 않은 로그인입니다">
        {session.user.email} 로 등록된 직원 계정이 없거나 비활성 상태입니다. 점주에게 계정 등록·활성화를 요청하세요.
      </Alert>
      <Button variant="secondary" icon="logout" onClick={signOut}>다른 계정으로 로그인</Button>
    </div>
  );
}
