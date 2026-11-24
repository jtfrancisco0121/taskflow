import { createBrowserRouter } from 'react-router'
import { HomePage } from '../features/home/HomePage'
import { AppShell } from './AppShell'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [{ index: true, element: <HomePage /> }],
  },
])
