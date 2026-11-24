import { createBrowserRouter } from 'react-router'
import { SignInPage, SignUpPage } from '../features/auth'
import { ListViewPage } from '../features/tasks'
import { WorkspaceHomePage } from '../features/locations'
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
            element: <WorkspaceHomePage />,
          },
          { path: '/w/:workspaceId/l/:locationId', element: <ListViewPage /> },
        ],
      },
    ],
  },
])
