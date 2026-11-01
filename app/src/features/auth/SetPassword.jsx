import { useEffect, useState } from 'react';
import { Alert, Field } from '../../components/ui/index.jsx';
import { useAuth } from '../../lib/auth.jsx';

// 초대·비밀번호 재설정 메일의 링크로 들어온 사용자가 처음 비밀번호를 정하는 화면.
// 링크로 로그인된 세션은 있지만 비밀번호가 없어서, 이 화면에서 정하지 않으면 다음에 로그인할 수 없다.
const MIN_LENGTH = 8;

export function SetPasswordPage() {
  const { account, setPassword, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = '비밀번호 설정 · 운영 관리'; }, []);

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (pw.length < MIN_LENGTH) next.pw = `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`;
    if (pw2 !== pw) next.pw2 = '비밀번호가 서로 다릅니다.';
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    const msg = await setPassword(pw);
    setBusy(false);
    if (msg) setFailure(msg);
  };

  return (
    <main className="entry">
      <div className="entry-inner">
        <div className="entry-brand">
          <h1 className="entry-title">비밀번호를 정해 주세요</h1>
          <p className="entry-desc">{account?.name ? `${account.name}님, ` : ''}앞으로 이메일과 이 비밀번호로 로그인합니다. 설정이 끝나면 바로 이동합니다.</p>
        </div>
        <div className="login-row">
          <form className="login-card" onSubmit={submit} noValidate>
            <h2 className="login-title">비밀번호 설정</h2>
            {failure && <Alert tone="danger" title={failure} live />}
            <Field id="new-pw" label="새 비밀번호" required help={`${MIN_LENGTH}자 이상`} error={errors.pw}>
              <input id="new-pw" className="input" type="password" autoComplete="new-password" value={pw}
                onChange={(e) => setPw(e.target.value)} aria-invalid={!!errors.pw} />
            </Field>
            <Field id="new-pw2" label="새 비밀번호 확인" required error={errors.pw2}>
              <input id="new-pw2" className="input" type="password" autoComplete="new-password" value={pw2}
                onChange={(e) => setPw2(e.target.value)} aria-invalid={!!errors.pw2} />
            </Field>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? '설정 중…' : '비밀번호 설정'}</button>
            <button type="button" className="btn btn-text btn-block" onClick={signOut}>취소하고 로그아웃</button>
          </form>
        </div>
      </div>
    </main>
  );
}

// 링크로 들어온 직후에는 비밀번호를 정하기 전까지 다른 화면으로 가지 못하게 막는다.
export function PasswordGate({ children }) {
  const { needsPassword, session, loading } = useAuth();
  if (!needsPassword) return children;
  if (session === undefined || loading) return <p className="auth-loading" role="status">계정을 확인하는 중…</p>;
  return session ? <SetPasswordPage /> : children; // 링크가 만료돼 세션이 없으면 로그인 화면으로
}
