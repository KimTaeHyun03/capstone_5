// CSS 순서: 레이아웃 기본형(@layer) → 토큰 → 제품 스타일
import './styles/layout-primitives.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.jsx';
import { AuthProvider, markPasswordLink } from './lib/auth.jsx';
import { PasswordGate } from './features/auth/SetPassword.jsx';
import { AppStateProvider } from './state/AppState.jsx';
import { ToastProvider } from './components/ui/index.jsx';

// Supabase 초대 링크의 인증 hash를 먼저 소비한 뒤 HashRouter를 렌더링한다.
import { supabase } from './lib/supabase.js';
async function start() {
  if (supabase && /(?:access_token|error_description)=/.test(window.location.hash)) {
    // 초대·비밀번호 재설정 링크면 비밀번호를 정하는 화면을 먼저 보여 준다(hash 를 지우기 전에 판별)
    if (/[#&]type=(?:invite|recovery)(?:&|$)/.test(window.location.hash)) markPasswordLink();
    await supabase.auth.getSession();
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  }
  createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <PasswordGate>
        <AppStateProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AppStateProvider>
      </PasswordGate>
    </AuthProvider>
  </StrictMode>
);
}
start();
