import { createBrowserRouter, type RouteObject } from 'react-router'
import { SignInPage, SignUpPage } from '../features/auth'
import { AutomationsPage } from '../features/automations'
import { TaskTabs } from '../features/comments'
import { TaskPanelRoute } from '../features/tasks'
import { WorkspaceHomePage } from '../features/locations'
import { InboxPage, NotificationSettingsPage } from '../features/notifications'
import { Presence } from '../features/realtime'
import { ServiceAccountDetailPage, ServiceAccountsPage } from '../features/serviceAccounts'
import { LocationViewRoute, ViewBackground, WorkspaceViewRoute } from '../features/views'
import { SetupPage, WorkspaceRedirect } from '../features/workspace'
import { AppShell } from './AppShell'
import { RequireSession } from './RequireSession'

// AD-6: /design exists only in development builds (import.meta.env.DEV is false in `vite build`, so the
// route and the lazy import are removed), and outside RequireSession so it needs no sign-in or backend.
const designRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/design',
        lazy: async () => ({ Component: (await import('../design/DesignPage')).DesignPage }),
      },
    ]
  : []

// AD-3: every route is declared here and only here.
export const router = createBrowserRouter([
  ...designRoutes,
  { path: '/signin', element: <SignInPage /> },
  { path: '/signup', element: <SignUpPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <WorkspaceRedirect /> },
          { path: '/setup', element: <SetupPage /> },
          {
            path: '/w/:workspaceId',
            element: <WorkspaceHomePage populated={<WorkspaceViewRoute />} />,
          },
          { path: '/w/:workspaceId/inbox', element: <InboxPage /> },
          {
            path: '/w/:workspaceId/settings/notifications',
            element: <NotificationSettingsPage />,
          },
          { path: '/w/:workspaceId/settings/service-accounts', element: <ServiceAccountsPage /> },
          {
            path: '/w/:workspaceId/settings/service-accounts/:serviceAccountId',
            element: <ServiceAccountDetailPage />,
          },
          { path: '/w/:workspaceId/v/:viewId', element: <WorkspaceViewRoute /> },
          // the existing List URL renders the Default List view (phase 1 links keep working)
          { path: '/w/:workspaceId/l/:locationId', element: <LocationViewRoute /> },
          { path: '/w/:workspaceId/l/:locationId/v/:viewId', element: <LocationViewRoute /> },
          { path: '/w/:workspaceId/l/:locationId/automations', element: <AutomationsPage /> },
          {
            path: '/t/:taskId',
            element: (
              <TaskPanelRoute
                background={(location) => <ViewBackground location={location} />}
                tabs={(task) => (
                  <>
                    <Presence taskId={task.id!} workspaceId={task.workspaceId!} />
                    <TaskTabs task={task} />
                  </>
                )}
              />
            ),
          },
        ],
      },
    ],
  },
])
