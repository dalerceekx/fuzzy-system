import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole, RoleHomeRedirect } from '@/features/auth/components/guards';
import { can } from '@/features/auth/lib/permissions';
import LoginPage from '@/pages/auth/LoginPage';
import { MfaSetupPage, MfaVerifyPage } from '@/pages/auth/MfaPages';
import { ForgotPasswordPage, RegisterPage, ResetPasswordPage, VerifyPhonePage } from '@/pages/auth/RegistrationPages';
import {
  ProfileEmailPage,
  ProfileLayout,
  ProfileOverviewPage,
  ProfilePasswordPage,
  ProfileSecurityPage,
} from '@/pages/profile/ProfilePages';
import { PageLoader } from '@/shared/ui';
import { AppLayout } from '../layouts/AppLayout';
import { NotFoundPage, RouteError } from './RouteError';

type PageModule = { default: ComponentType };

/** Code-split page: loaded on first visit. */
function page(load: () => Promise<PageModule>): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: (await load()).default }) };
}

/** Shown while the first code-split page loads (a deep link or a reload). */
function InitialPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <PageLoader />
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: <InitialPageLoader />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/login/mfa', element: <MfaVerifyPage /> },
          { path: '/login/mfa-setup', element: <MfaSetupPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/register/verify', element: <VerifyPhonePage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/forgot-password/reset', element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            errorElement: <RouteError />,
            children: [
              { path: '/', element: <RoleHomeRedirect /> },
              {
                path: '/profile',
                element: <ProfileLayout />,
                handle: { title: 'Profil', description: 'Shaxsiy ma’lumotlar va xavfsizlik' },
                children: [
                  { index: true, element: <ProfileOverviewPage /> },
                  { path: 'email', element: <ProfileEmailPage />, handle: { title: 'Email qo‘shish' } },
                  { path: 'password', element: <ProfilePasswordPage />, handle: { title: 'Parolni almashtirish' } },
                  { path: 'security', element: <ProfileSecurityPage />, handle: { title: 'Kirish usullari' } },
                ],
              },
              {
                element: <RequireRole allow={can.useFarmerApp} />,
                children: [
                  {
                    path: '/dashboard',
                    handle: { title: 'Bosh sahifa', description: 'Fermangiz holati bir qarashda' },
                    ...page(() => import('@/pages/farmer/DashboardPage')),
                  },
                  {
                    path: '/animals',
                    handle: { title: 'Hayvonlar', description: 'Podadagi barcha hayvonlar ro‘yxati' },
                    ...page(() => import('@/pages/farmer/AnimalsPage')),
                  },
                  {
                    path: '/animals/:animalId',
                    handle: { title: 'Hayvon ma’lumotlari' },
                    ...page(() => import('@/pages/farmer/AnimalDetailsPage')),
                  },
                  {
                    path: '/animal-groups',
                    handle: { title: 'Hayvon guruhlari', description: 'Tur bo‘yicha guruhlar' },
                    ...page(() => import('@/pages/farmer/AnimalGroupsPage')),
                  },
                  {
                    path: '/feed',
                    handle: { title: 'Yem ombori', description: 'Yemlar, ularning miqdori, narxi, kirim va sarfi' },
                    ...page(() => import('@/pages/farmer/FeedInventoryPage')),
                  },
                  {
                    path: '/feed/:itemId',
                    handle: { title: 'Yem harakatlari tarixi' },
                    ...page(() => import('@/pages/farmer/InventoryItemPage')),
                  },
                  {
                    path: '/feed-calculator',
                    handle: {
                      title: 'Yem hisoblagich',
                      description: 'Hayvon turini tanlang va ombordagi yemlardan ratsion tuzing',
                    },
                    ...page(() => import('@/pages/farmer/FeedCalculatorPage')),
                  },
                  {
                    path: '/feed-calculator/types/:typeId',
                    handle: { title: 'Ratsionlar', description: 'Tanlangan hayvon turining saqlangan ratsionlari' },
                    ...page(() => import('@/pages/farmer/RationTypePage')),
                  },
                  {
                    path: '/feed-calculator/types/:typeId/new',
                    handle: { title: 'Yangi ratsion', description: 'Hisoblash va saqlash ombordagi qoldiqni o‘zgartirmaydi' },
                    ...page(() => import('@/pages/farmer/RationEditorPage')),
                  },
                  {
                    path: '/feed-calculator/rations/:rationId',
                    handle: { title: 'Ratsion natijalari' },
                    ...page(() => import('@/pages/farmer/RationPage')),
                  },
                  {
                    path: '/feed-calculator/rations/:rationId/edit',
                    handle: { title: 'Ratsionni tahrirlash', description: 'O‘zgartirishdan keyin hisob qayta bajariladi' },
                    ...page(() => import('@/pages/farmer/RationEditorPage')),
                  },
                  {
                    path: '/medicines',
                    handle: { title: 'Dori ombori', description: 'Veterinariya dorilari va vitaminlar hisobi' },
                    ...page(() => import('@/pages/farmer/MedicinesPage')),
                  },
                  {
                    path: '/diseases',
                    handle: { title: 'Molim kasal', description: 'Kasalliklar ma’lumotnomasi — manba matni' },
                    ...page(() => import('@/pages/farmer/DiseasesPage')),
                  },
                  {
                    path: '/diseases/source',
                    handle: { title: 'Asl matn', description: 'Kasalliklar ma’lumotnomasining to‘liq manba matni' },
                    ...page(() => import('@/pages/farmer/DiseaseSourcePage')),
                  },
                  {
                    path: '/diseases/:number',
                    handle: { title: 'Kasallik', description: 'Manba matni — veterinar tasdig‘i talab qilinadi' },
                    ...page(() => import('@/pages/farmer/DiseasePage')),
                  },
                  {
                    path: '/medicines/stock/:itemId',
                    handle: { title: 'Dori harakatlari tarixi' },
                    ...page(() => import('@/pages/farmer/InventoryItemPage')),
                  },
                  // Expenses moved to a panel on the dashboard; old links land on it.
                  { path: '/expenses', element: <Navigate to="/dashboard#xarajatlar" replace /> },
                  {
                    path: '/reports',
                    handle: { title: 'Hisobotlar', description: 'Backend ma’lumotlari asosidagi hisobotlar' },
                    ...page(() => import('@/pages/farmer/ReportsPage')),
                  },
                  {
                    path: '/farms',
                    handle: { title: 'Fermalarim', description: 'Fermalarni qo‘shish va tahrirlash' },
                    ...page(() => import('@/pages/farmer/FarmsPage')),
                  },
                ],
              },
              {
                path: '/admin',
                element: <RequireRole allow={can.useStaffApp} />,
                children: [
                  {
                    element: <RequireRole allow={can.viewUsers} />,
                    children: [
                      {
                        index: true,
                        handle: { title: 'Boshqaruv paneli', description: 'Tizim bo‘yicha umumiy ko‘rsatkichlar' },
                        ...page(() => import('@/pages/admin/AdminDashboardPage')),
                      },
                      {
                        path: 'users',
                        handle: { title: 'Foydalanuvchilar', description: 'Hisoblar, rollar va holatlar' },
                        ...page(() => import('@/pages/admin/UsersPage')),
                      },
                      {
                        path: 'users/:userId',
                        handle: { title: 'Foydalanuvchi' },
                        ...page(() => import('@/pages/admin/UserDetailsPage')),
                      },
                      {
                        path: 'roles',
                        handle: { title: 'Rollar', description: 'Rollar va ularning huquqlari' },
                        ...page(() => import('@/pages/admin/RolesPage')),
                      },
                    ],
                  },
                  {
                    element: <RequireRole allow={can.viewAuditLogs} />,
                    children: [
                      {
                        path: 'audit-logs',
                        handle: { title: 'Audit loglar', description: 'Tizimdagi muhim amallar tarixi (faqat o‘qish)' },
                        ...page(() => import('@/pages/admin/AuditLogsPage')),
                      },
                    ],
                  },
                  {
                    path: 'medicines',
                    handle: { title: 'Dorilar katalogi', description: 'Dorilar va ularning tasdiqlash holati' },
                    ...page(() => import('@/pages/admin/MedicinesAdminPage')),
                  },
                  {
                    element: <RequireRole allow={can.manageUsers} />,
                    children: [
                      {
                        path: 'settings',
                        handle: { title: 'Sozlamalar' },
                        ...page(() => import('@/pages/admin/SettingsPage')),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
