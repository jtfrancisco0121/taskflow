import { createBrowserRouter } from 'react-router'
import { SignInPage, SignUpPage } from '../features/auth'
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
            element: <p className="text-slate-600">Pick a List in the sidebar.</p>,
          },
          { path: '/w/:workspaceId/l/:locationId', element: <p>List</p> },
        ],
      },
    ],
  },
])
