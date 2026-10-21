import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Icon, IconButton } from '../components/ui/index.jsx';
import { useApp } from '../state/AppState.jsx';
import { STORE } from '../mocks/data.js';
import { STAFF_TABS } from './nav.js';

// 역할 루트 경로 — 같은 페이지 컴포넌트를 점주·매니저가 함께 쓸 때 링크를 맞춘다
const BaseCtx = createContext('/owner');
export const useBase = () => useContext(BaseCtx);
export const useRolePath = () => { const base = useBase(); return (p = '') => (p ? `${base}/${p}` : base); };

export function BrandMark({ to = '/' }) {
  return (
    <Link className="brand-mark" to={to}>
      <span className="brand-logo"><Icon name="coffee" /></span>
      카페 온기
    </Link>
  );
}

function useScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return pathname;
}

function SideNav({ base, nav, onNavigate }) {
  const { lowStock, reports } = useApp();
  const counts = { alerts: lowStock.length + reports.length };
  return (
    <nav className="nav" aria-label="주 메뉴">
      {nav.map((g) => (
        <div className="nav-group" key={g.id}>
          <span className="nav-group-label"><Icon name={g.icon} />{g.label}</span>
          {g.items.map((it) => {
            const to = it.path ? `${base}/${it.path}` : base;
            return (
              <NavLink key={to} to={to} end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={onNavigate}>
                <span className="nav-link-label">{it.label}</span>
                {it.badge && counts[it.badge] > 0 && <span className="nav-count" aria-label={`${counts[it.badge]}건`}>{counts[it.badge]}</span>}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/* 점주·매니저 공통 셸 — 데스크톱 사이드바, 1023px 이하 서랍 */
export function AdminLayout({ base, nav, user }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = useScrollTop();
  const current = nav.flatMap((g) => g.items.map((it) => ({ ...it, group: g })))
    .find((it) => (it.path ? `${base}/${it.path}` : base) === pathname);
  useEffect(() => {
    setDrawer(false);
    document.title = `${current ? current.label : '카페 온기'} · 카페 온기 운영 관리`;
  }, [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <BaseCtx.Provider value={base}>
      <a className="skip-link" href="#main">본문 바로가기</a>
      <div className="shell">
        <div className={`drawer-backdrop ${drawer ? 'open' : ''}`} onClick={() => setDrawer(false)} aria-hidden="true" />
        <aside className={`sidebar ${drawer ? 'open' : ''}`} aria-label="사이드바">
          <div className="sidebar-brand od-row">
            <BrandMark to={base} />
            <span className="push menu-btn"><IconButton icon="close" label="메뉴 닫기" onClick={() => setDrawer(false)} /></span>
          </div>
          <div className="store-chip">
            <span className="avatar" aria-hidden="true">{user.name.slice(1)}</span>
            <div className="store-chip-text">
              <span className="store-chip-name">{user.name}</span>
              <span className="store-chip-role">{STORE.name} · {user.role}</span>
            </div>
          </div>
          <SideNav base={base} nav={nav} onNavigate={() => setDrawer(false)} />
          <div className="sidebar-foot">
            <Link className="nav-link" to="/" style={{ paddingLeft: 8 }}><Icon name="logout" size="sm" /><span className="nav-link-label">로그아웃</span></Link>
          </div>
        </aside>
        <div className="main">
          <div className="topbar">
            <span className="menu-btn"><IconButton icon="menu" label="메뉴 열기" aria-expanded={drawer} onClick={() => setDrawer(true)} /></span>
            <span className="crumb">{current?.group && current.group.id !== 'home' ? <>{current.group.label} / </> : null}<strong>{current?.label || ''}</strong></span>
            <span className="push" />
            <NotifBell base={base} />
          </div>
          <main id="main" className="main-inner" key={pathname} tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </BaseCtx.Provider>
  );
}

function NotifBell({ base }) {
  const { unread } = useApp();
  return (
    <Link className="btn btn-ghost btn-icon" to={`${base}/alerts`.replace('/owner/alerts', '/owner/stock/alerts')} aria-label={`알림 ${unread}건 읽지 않음`} style={{ position: 'relative' }}>
      <Icon name="bell" size="md" />
      {unread > 0 && <span className="nav-count" style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, lineHeight: '18px', fontSize: 10 }} aria-hidden="true">{unread}</span>}
    </Link>
  );
}

/* 알바생 모바일 셸 — 최대 480px 열, 하단 탭 5개 */
export function StaffLayout() {
  const pathname = useScrollTop();
  const tab = STAFF_TABS.find((t) => (t.path ? `/staff/${t.path}` : '/staff') === pathname) || STAFF_TABS[0];
  useEffect(() => { document.title = `${tab.label} · 카페 온기`; }, [tab]);
  return (
    <BaseCtx.Provider value="/staff">
      <div className="staff-app">
        <div className="staff-col">
          <header className="staff-top">
            <h1 className="staff-top-title">{tab.label}</h1>
            <Link className="btn btn-ghost btn-icon" to="/" aria-label="로그아웃"><Icon name="logout" size="md" /></Link>
          </header>
          <main className="staff-body" key={pathname}>
            <Outlet />
          </main>
          <nav className="tabbar" aria-label="하단 메뉴">
            {STAFF_TABS.map((t) => {
              const to = t.path ? `/staff/${t.path}` : '/staff';
              return (
                <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon name={t.icon} />
                  <span>{t.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>
    </BaseCtx.Provider>
  );
}
