import { screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { setSession } from '../api/session'
import { TaskPanelRoute } from '../features/tasks'
import { installFetch, json, renderWithProviders } from '../test/api'
import { AppShell } from './AppShell'

describe('task link', () => {
  it('FR-7: opening a task from another Workspace switches the current Workspace to the task one', async () => {
    setSession('tok', { id: 'u1', displayName: 'Maya' })
    const stub = installFetch({
      'GET /api/v1/workspaces': {
        items: [
          { id: 'w1', name: 'Acme', role: 'OWNER' },
          { id: 'w2', name: 'Beta', role: 'MEMBER' },
        ],
      },
      'GET /api/v1/workspaces/:id/tree': {
        items: [{ id: 's9', name: 'Beta Space', type: 'SPACE' }],
      },
      'GET /api/v1/workspaces/:id/members': { items: [] },
      'GET /api/v1/tasks/:id': json({
        id: 't1',
        workspaceId: 'w2',
        listId: 'l9',
        readableId: 'BETA-1',
        title: 'Cross task',
        version: 1,
      }),
      'GET /api/v1/tasks': { items: [] },
      'GET /api/v1/locations/:id': { id: 'l9', name: 'Inbox', type: 'LIST', workspaceId: 'w2' },
      'GET /api/v1/locations/:id/statuses': { statuses: [] },
    })
    renderWithProviders(
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/t/:taskId" element={<TaskPanelRoute />} />
        </Route>
      </Routes>,
      { route: '/t/t1' },
    )

    expect(await screen.findByRole('complementary', { name: 'Task BETA-1' })).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Workspace switcher' })).toHaveTextContent('Beta'),
    )
    expect(localStorage.getItem('taskflow:lastWorkspace')).toBe('w2')
    expect(await screen.findByRole('treeitem', { name: 'Beta Space' })).toBeVisible()
    expect(stub.calls.some((c) => c.url.pathname === '/api/v1/workspaces/w2/tree')).toBe(true)
    expect(stub.calls.some((c) => c.url.pathname === '/api/v1/workspaces/w1/tree')).toBe(false)
  })
})
