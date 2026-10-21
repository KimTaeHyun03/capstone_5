import { createHashRouter, Navigate } from 'react-router-dom';
import { AdminLayout, StaffLayout } from './layouts/Layouts.jsx';
import { OWNER_NAV, MANAGER_NAV } from './layouts/nav.js';
import { OWNER, STAFF } from './mocks/data.js';
import EntryPage from './features/auth/EntryPage.jsx';
import { OwnerDashboard, SalesStatusPage, ForecastPage } from './features/sales/SalesPages.jsx';
import { AvailabilityPage, SchedulePage, ScheduleReviewPage } from './features/schedule/SchedulePages.jsx';
import LaborPage from './features/attendance/LaborPage.jsx';
import { InventoryPage, AlertsPage, StocktakePage } from './features/inventory/InventoryPages.jsx';
import { RecommendPage, OrdersPage, ReceivePage, CorrectionPage } from './features/order/OrderPages.jsx';
import { StorePage, MenuPage, IngredientPage } from './features/base/BasePages.jsx';
import ManagerHome from './features/manager/ManagerHome.jsx';
import { StaffSchedule, StaffAvailability, StaffClock, StaffPay, StaffReport } from './features/staff/StaffPages.jsx';

// 해시 라우팅: #/owner/... · #/manager/... · #/staff/...  (Vercel rewrite 없이 새로고침·직접 링크 동작)
export const router = createHashRouter([
  { path: '/', element: <EntryPage /> },
  {
    path: '/owner',
    element: <AdminLayout base="/owner" nav={OWNER_NAV} user={OWNER} />,
    children: [
      { index: true, element: <OwnerDashboard /> },
      { path: 'sales/status', element: <SalesStatusPage /> },
      { path: 'sales/forecast', element: <ForecastPage /> },
      { path: 'work/availability', element: <AvailabilityPage /> },
      { path: 'work/schedule', element: <SchedulePage /> },
      { path: 'work/labor', element: <LaborPage /> },
      { path: 'stock/inventory', element: <InventoryPage /> },
      { path: 'stock/alerts', element: <AlertsPage /> },
      { path: 'order/recommend', element: <RecommendPage /> },
      { path: 'order/orders', element: <OrdersPage /> },
      { path: 'order/correction', element: <CorrectionPage /> },
      { path: 'base/store', element: <StorePage /> },
      { path: 'base/menu', element: <MenuPage /> },
      { path: 'base/ingredient', element: <IngredientPage /> },
    ],
  },
  {
    path: '/manager',
    element: <AdminLayout base="/manager" nav={MANAGER_NAV} user={STAFF[0]} />,
    children: [
      { index: true, element: <ManagerHome /> },
      { path: 'availability', element: <AvailabilityPage /> },
      { path: 'schedule', element: <ScheduleReviewPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'stocktake', element: <StocktakePage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'receive', element: <ReceivePage /> },
    ],
  },
  {
    path: '/staff',
    element: <StaffLayout />,
    children: [
      { index: true, element: <StaffSchedule /> },
      { path: 'availability', element: <StaffAvailability /> },
      { path: 'clock', element: <StaffClock /> },
      { path: 'pay', element: <StaffPay /> },
      { path: 'report', element: <StaffReport /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
