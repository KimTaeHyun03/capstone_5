/* 0단계 · 인증 — Supabase Auth(이메일/비밀번호) + user_account 연결 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from './supabase.js';

export const ROLE_HOME = { 점주: '/owner', 매니저: '/manager', 알바생: '/staff' };

// password_hash 는 컬럼 권한으로 막혀 있으므로 '*' 대신 필요한 컬럼만 고른다
const ACCOUNT_COLS = 'user_id, store_id, login_id, name, role, status, store:store_id (store_name)';

// 초대·비밀번호 재설정 링크로 들어왔는지(비밀번호를 정하기 전인지)는 새로고침해도 유지되게 이 탭의 sessionStorage 에 둔다
const PW_KEY = 'needs-password';
export const markPasswordLink = () => { try { sessionStorage.setItem(PW_KEY, '1'); } catch { /* 저장 못 하면 이번 화면에서만 적용 */ } };
const readNeedsPassword = () => { try { return sessionStorage.getItem(PW_KEY) === '1'; } catch { return false; } };
const clearNeedsPassword = () => { try { sessionStorage.removeItem(PW_KEY); } catch { /* 무시 */ } };

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL·PUBLISHABLE_KEY)가 없으면 로그인할 수 없다 — 로컬 개발은 app/.env.local 에 넣는다
export function AuthProvider({ children }) {
  if (!supabase) return <p className="auth-loading" role="alert">서버 연결 설정(Supabase 환경변수)이 없어 시작할 수 없습니다.</p>;
  return <AuthState>{children}</AuthState>;
}

function AuthState({ children }) {
  const [session, setSession] = useState(undefined); // undefined = 확인 중
  const [account, setAccount] = useState(undefined); // null = 연결된 계정 없음
  const [needsPassword, setNeedsPassword] = useState(readNeedsPassword);
  const [accountKey, setAccountKey] = useState(0); // 값이 바뀌면 user_account 를 다시 읽는다(매장 등록 직후)
  const [accountStatus, setAccountStatus] = useState('ok'); // 'ok' | 'none'(매장에 연결 안 됨 → 점주 온보딩) | 'inactive'(비활성)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // 콜백 안에서 Supabase 를 다시 호출하면 교착될 수 있어 세션만 저장하고 조회는 아래 effect 에서 한다
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 토큰 갱신 때마다 세션 객체가 바뀌므로 계정 조회는 사용자 ID 가 바뀔 때만 한다
  const checked = session !== undefined;
  const userId = session?.user?.id;
  useEffect(() => {
    if (!checked) return;
    if (!userId) { setAccount(null); return; }
    let alive = true;
    setAccount(undefined);
    supabase.from('user_account').select(ACCOUNT_COLS).eq('auth_user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.error(error);
        setAccountStatus(!data ? 'none' : data.status === '활성' ? 'ok' : 'inactive');
        // 비활성 계정은 RLS 헬퍼가 매장 데이터를 막으므로 여기서도 연결 안 된 것으로 본다
        setAccount(data && data.status === '활성'
          ? { id: data.user_id, storeId: data.store_id, email: data.login_id, name: data.name, role: data.role, storeName: data.store?.store_name }
          : null);
      });
    return () => { alive = false; };
  }, [checked, userId, accountKey]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return null;
    if (error.message.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다.';
    if (error.message.includes('Email not confirmed')) return '이메일 인증이 아직 끝나지 않았습니다.';
    return `로그인하지 못했습니다. (${error.message})`;
  }, []);

  const signOut = useCallback(async () => {
    clearNeedsPassword(); setNeedsPassword(false);
    await supabase.auth.signOut();
  }, []);

  // 점주 가입(이메일·비밀번호). 이메일 인증이 켜져 있으면 세션 없이 돌아오므로 인증 메일 안내를 돌려준다.
  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
    if (error) {
      if (/already registered|already been registered/i.test(error.message)) return { error: '이미 가입된 이메일입니다. 로그인하세요.' };
      if (/password/i.test(error.message)) return { error: '비밀번호가 너무 짧거나 쉬워요. 8자 이상으로 입력하세요.' };
      if (/rate limit|too many/i.test(error.message)) return { error: '잠시 뒤에 다시 시도하세요. (메일 발송 횟수 제한)' };
      return { error: `가입하지 못했습니다. (${error.message})` };
    }
    // 이미 가입된 이메일이면 보안상 오류 없이 identities 가 비어 돌아온다
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { error: '이미 가입된 이메일입니다. 로그인하세요.' };
    return { confirmEmail: !data.session };
  }, []);

  // 점주 온보딩: 매장을 만들고 이 계정을 그 매장의 점주로 등록한다. 성공하면 null, 실패하면 안내 문구
  const registerStore = useCallback(async (v) => {
    const { error } = await supabase.rpc('register_store', {
      p_store_name: v.storeName, p_owner_name: v.ownerName, p_address: v.address || null, p_phone: v.phone || null,
      p_open: v.open, p_close: v.close,
    });
    if (error) return error.message;
    setAccountKey((k) => k + 1);
    return null;
  }, []);

  // 초대·재설정 링크로 로그인된 사용자의 첫 비밀번호 설정. 성공하면 null, 실패하면 안내 문구를 돌려준다
  const setPassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (/same|different from the old/i.test(error.message)) return '이전과 다른 비밀번호를 입력하세요.';
      if (/weak|at least|characters/i.test(error.message)) return '비밀번호가 너무 짧거나 쉬워요. 더 길고 복잡하게 입력하세요.';
      return `비밀번호를 설정하지 못했습니다. (${error.message})`;
    }
    clearNeedsPassword(); setNeedsPassword(false);
    return null;
  }, []);

  const loading = !checked || (!!userId && account === undefined);
  const value = { loading, session, account, accountStatus, signIn, signOut, signUp, registerStore, needsPassword, setPassword };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* 역할별 라우트 가드 — 로그인 안 했으면 로그인 화면, 다른 역할이면 자기 홈으로 */
export function RequireRole({ role, children }) {
  const { loading, account } = useAuth();
  if (loading) return <p className="auth-loading" role="status">계정을 확인하는 중…</p>;
  if (!account) return <Navigate to="/" replace />;
  if (account.role !== role) return <Navigate to={ROLE_HOME[account.role] || '/'} replace />;
  return children;
}
