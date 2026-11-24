import { createBrowserRouter } from 'react-router'
import { HomePage } from '../features/home/HomePage'
import { SignInPage, SignUpPage } from '../features/auth'
import { AppShell } from './AppShell'
import { RequireSession } from './RequireSession'

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInPage /> },
  { path: '/signup', element: <SignUpPage /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <HomePage /> },
          {
            path: '/setup',
            element: <h1 className="text-xl font-semibold">Create your Workspace</h1>,
          },
        ],
      },
    ],
  },
])
