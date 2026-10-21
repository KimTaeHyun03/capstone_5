import { createHashRouter, Navigate } from 'react-router-dom';
import { AdminLayout, StaffLayout } from './layouts/Layouts.jsx';
import { OWNER_NAV, MANAGER_NAV } from './layouts/nav.js';
import { OWNER, STAFF } from './mocks/data.js';
import { LoginPage, RouteGate } from './features/auth/OperationsAuth.jsx';
import { SalesRecords, SalesSummary } from './features/sales/SalesRecords.jsx';
import { AvailabilityOverview, AvailabilityEditor } from './features/schedule/AvailabilityOverview.jsx';
import { OwnerDashboard, SalesStatusPage, ForecastPage } from './features/sales/SalesPages.jsx';
import { AvailabilityPage, SchedulePage, ScheduleReviewPage } from './features/schedule/SchedulePages.jsx';
import LaborPage from './features/attendance/LaborPage.jsx';
import { InventoryPage, AlertsPage, StocktakePage } from './features/inventory/InventoryPages.jsx';
import { RecommendPage, OrdersPage, ReceivePage, CorrectionPage } from './features/order/OrderPages.jsx';
import { StorePage, MenuPage, IngredientPage } from './features/base/BaseManagement.jsx';
import ManagerHome from './features/manager/ManagerHome.jsx';
import { StaffSchedule, StaffAvailability, StaffClock, StaffPay, StaffReport } from './features/staff/StaffPages.jsx';

// 해시 라우팅: #/owner/... · #/manager/... · #/staff/...  (Vercel rewrite 없이 새로고침·직접 링크 동작)
export const router = createHashRouter([
  { path: '/', element: <LoginPage /> },
  {
    path: '/owner',
    element: <RouteGate role="점주"><AdminLayout base="/owner" nav={OWNER_NAV} user={OWNER} /></RouteGate>,
    children: [
      { index: true, element: <OwnerDashboard /> },
      { path: 'sales/status', element: <SalesSummary standalone /> },
      { path: 'sales/records', element: <SalesRecords /> },
      { path: 'sales/forecast', element: <ForecastPage /> },
      { path: 'work/availability', element: <AvailabilityOverview /> },
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
    element: <RouteGate role="매니저"><AdminLayout base="/manager" nav={MANAGER_NAV} user={STAFF[0]} /></RouteGate>,
    children: [
      { index: true, element: <ManagerHome /> },
      { path: 'availability', element: <AvailabilityOverview /> },
      { path: 'my-availability', element: <AvailabilityEditor /> },
      { path: 'schedule', element: <ScheduleReviewPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'stocktake', element: <StocktakePage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'receive', element: <ReceivePage /> },
    ],
  },
  {
    path: '/staff',
    element: <RouteGate role="알바생"><StaffLayout /></RouteGate>,
    children: [
      { index: true, element: <StaffSchedule /> },
      { path: 'availability', element: <AvailabilityEditor /> },
      { path: 'clock', element: <StaffClock /> },
      { path: 'pay', element: <StaffPay /> },
      { path: 'report', element: <StaffReport /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
