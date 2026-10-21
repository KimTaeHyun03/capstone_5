// CSS 순서: 레이아웃 기본형(@layer) → 토큰 → 제품 스타일
import './styles/layout-primitives.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.jsx';
import { AppStateProvider } from './state/AppState.jsx';
import { ToastProvider } from './components/ui/index.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppStateProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AppStateProvider>
  </StrictMode>
);
