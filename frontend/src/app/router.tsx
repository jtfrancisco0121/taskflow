import { createBrowserRouter } from 'react-router'
import { SignInPage, SignUpPage } from '../features/auth'
import { TaskTabs } from '../features/comments'
import { TaskPanelRoute } from '../features/tasks'
import { WorkspaceHomePage } from '../features/locations'
import { Presence } from '../features/realtime'
import { ServiceAccountDetailPage, ServiceAccountsPage } from '../features/serviceAccounts'
import { LocationViewRoute, ViewBackground, WorkspaceViewRoute } from '../features/views'
import { SetupPage, WorkspaceRedirect } from '../features/workspace'
import { AppShell } from './AppShell'
import { RequireSession } from './RequireSession'

// AD-3: every route is declared here and only here.
export const router = createBrowserRouter([
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
          { path: '/w/:workspaceId/settings/service-accounts', element: <ServiceAccountsPage /> },
          {
            path: '/w/:workspaceId/settings/service-accounts/:serviceAccountId',
            element: <ServiceAccountDetailPage />,
          },
          { path: '/w/:workspaceId/v/:viewId', element: <WorkspaceViewRoute /> },
          // the existing List URL renders the Default List view (phase 1 links keep working)
          { path: '/w/:workspaceId/l/:locationId', element: <LocationViewRoute /> },
          { path: '/w/:workspaceId/l/:locationId/v/:viewId', element: <LocationViewRoute /> },
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
