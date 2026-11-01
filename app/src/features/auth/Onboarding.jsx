import { useState } from 'react';
import { Alert, Button, Field } from '../../components/ui/index.jsx';
import { useAuth } from '../../lib/auth.jsx';

const MIN_PW = 8;

// 로그인 / 점주 가입 전환. LoginForm 은 EntryPage 가 넘겨 준다.
export function LoginOrSignUp({ LoginForm }) {
  const [mode, setMode] = useState('login');
  return (
    <div>
      <div className="tabs-inline" role="group" aria-label="시작 방법" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button variant={mode === 'login' ? 'primary' : 'secondary'} aria-pressed={mode === 'login'} onClick={() => setMode('login')}>로그인</Button>
        <Button variant={mode === 'signup' ? 'primary' : 'secondary'} aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>점주로 시작하기</Button>
      </div>
      {mode === 'login' ? <LoginForm /> : <SignUpForm onDone={() => setMode('login')} />}
    </div>
  );
}

// 점주 가입 — 이메일·비밀번호. 인증 메일의 링크를 누르면 매장 등록 화면으로 이어진다
function SignUpForm({ onDone }) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = '이메일 형식을 확인하세요.';
    if (pw.length < MIN_PW) next.pw = `비밀번호는 ${MIN_PW}자 이상이어야 합니다.`;
    if (pw2 !== pw) next.pw2 = '비밀번호가 서로 다릅니다.';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const r = await signUp(email.trim(), pw);
    setBusy(false);
    if (r.error) setFailure(r.error);
    else if (r.confirmEmail) setSent(true);
  };

  if (sent) {
    return (
      <div className="login-card">
        <h2 className="login-title">인증 메일을 보냈어요</h2>
        <Alert tone="success" title={`${email.trim()} 로 메일을 보냈습니다`}>메일의 링크를 누르면 매장 등록 화면으로 이어집니다. 메일이 안 보이면 스팸함도 확인하세요.</Alert>
        <Button variant="secondary" onClick={onDone}>로그인 화면으로</Button>
      </div>
    );
  }
  return (
    <form className="login-card" onSubmit={submit} noValidate>
      <h2 className="login-title">점주로 시작하기</h2>
      <p className="help">가입하면 내 매장을 등록하고 메뉴·재료·직원을 직접 관리할 수 있어요.</p>
      {failure && <Alert tone="danger" title={failure} live />}
      <Field id="su-email" label="이메일" required error={errors.email}>
        <input id="su-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
      </Field>
      <Field id="su-pw" label="비밀번호" required help={`${MIN_PW}자 이상`} error={errors.pw}>
        <input id="su-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!errors.pw} />
      </Field>
      <Field id="su-pw2" label="비밀번호 확인" required error={errors.pw2}>
        <input id="su-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!errors.pw2} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? '가입 중…' : '가입하기'}</button>
    </form>
  );
}

// 인증은 됐지만 아직 어느 매장에도 속하지 않은 가입자 → 매장 등록(점주 온보딩)
export function RegisterStore() {
  const { session, registerStore, signOut } = useAuth();
  const [v, setV] = useState({ ownerName: '', storeName: '', address: '', phone: '', open: '08:00', close: '22:00' });
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!v.ownerName.trim()) next.ownerName = '점주 이름을 입력하세요.';
    if (!v.storeName.trim()) next.storeName = '매장 이름을 입력하세요.';
    if (!v.open || !v.close || v.open >= v.close) next.close = '영업 종료 시각은 시작 시각보다 늦어야 합니다.';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const msg = await registerStore({ ...v, ownerName: v.ownerName.trim(), storeName: v.storeName.trim(), address: v.address.trim(), phone: v.phone.trim() });
    setBusy(false);
    if (msg) setFailure(msg);
  };

  return (
    <form className="login-card" onSubmit={submit} noValidate>
      <h2 className="login-title">내 매장 등록</h2>
      <p className="help">{session.user.email} 로 가입했어요. 매장 정보를 입력하면 바로 시작합니다. 영업시간은 나중에 바꿀 수 있어요.</p>
      {failure && <Alert tone="danger" title={failure} live />}
      <Field id="rs-owner" label="점주 이름" required error={errors.ownerName}>
        <input id="rs-owner" className="input" value={v.ownerName} onChange={set('ownerName')} aria-invalid={!!errors.ownerName} />
      </Field>
      <Field id="rs-store" label="매장 이름" required error={errors.storeName}>
        <input id="rs-store" className="input" value={v.storeName} onChange={set('storeName')} aria-invalid={!!errors.storeName} />
      </Field>
      <Field id="rs-addr" label="주소">
        <input id="rs-addr" className="input" value={v.address} onChange={set('address')} />
      </Field>
      <Field id="rs-phone" label="전화">
        <input id="rs-phone" className="input" value={v.phone} onChange={set('phone')} />
      </Field>
      <div style={{ display: 'flex', gap: 12 }}>
        <Field id="rs-open" label="영업 시작" required>
          <input id="rs-open" className="input" type="time" value={v.open} onChange={set('open')} />
        </Field>
        <Field id="rs-close" label="영업 종료" required error={errors.close}>
          <input id="rs-close" className="input" type="time" value={v.close} onChange={set('close')} aria-invalid={!!errors.close} />
        </Field>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? '등록 중…' : '매장 등록하고 시작하기'}</button>
      <button type="button" className="btn btn-text btn-block" onClick={signOut}>다른 계정으로 로그인</button>
    </form>
  );
}
