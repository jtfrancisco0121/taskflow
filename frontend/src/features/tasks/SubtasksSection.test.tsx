import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { StatusInfo, TaskView } from '../../api/types'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ParentLink, SubtasksSection } from './SubtasksSection'

const parent: TaskView = {
  id: 'p1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  number: 1,
}
const statuses: StatusInfo[] = [
  { id: 's1', name: 'To do', group: 'NOT_STARTED' },
  { id: 's2', name: 'Done', group: 'DONE' },
]
const child = (n: number, statusId = 's1') => ({
  id: `c${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  readableId: `ACME-${n}`,
  title: `Child ${n}`,
  parentTaskId: 'p1',
  statusId,
})

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderSection(task: TaskView = parent) {
  return renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ParentLink task={task} />
            <SubtasksSection task={task} statuses={statuses} />
            <Where />
          </>
        }
      />
    </Routes>,
    { route: '/t/p1' },
  )
}

describe('SubtasksSection (CAP-7)', () => {
  it('lists the children, unfinished first, and opens one in place of the current task', async () => {
    installFetch({ 'GET /api/v1/tasks': json({ items: [child(2, 's2'), child(3), parent] }) })
    const user = userEvent.setup()
    renderSection()
    const links = await screen.findAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Child 3', 'Child 2'])
    await user.click(links[0])
    expect(screen.getByTestId('where')).toHaveTextContent('/t/c3')
  })

  it('shows the empty text, and an error with Retry', async () => {
    let calls = 0
    installFetch({
      'GET /api/v1/tasks': () =>
        ++calls === 1 ? problem(500, 'boom', 'Server broke') : json({ items: [] }),
    })
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server broke')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No subtasks yet.')).toBeVisible()
  })

  it('Enter creates a subtask with its parent in the same List, clears and keeps focus', async () => {
    const stub = installFetch({
      'GET /api/v1/tasks': json({ items: [] }),
      'POST /api/v1/lists/:id/tasks': () => json(child(4), 201),
    })
    const user = userEvent.setup()
    renderSection()
    const field = await screen.findByRole('textbox', { name: 'Add a subtask' })
    await user.type(field, 'Write the migration note{Enter}')
    await waitFor(() => expect(field).toHaveValue(''))
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.url.pathname).toBe('/api/v1/lists/l1/tasks')
    expect(post.body).toEqual({ title: 'Write the migration note', parentTaskId: 'p1' })
    expect(field).toHaveFocus()
  })

  it('a refusal shows the server message under the field and keeps the text', async () => {
    installFetch({
      'GET /api/v1/tasks': json({ items: [] }),
      'POST /api/v1/lists/:id/tasks': problem(
        400,
        'task.too_deep',
        'Subtasks cannot nest that deep',
      ),
    })
    const user = userEvent.setup()
    renderSection()
    const field = await screen.findByRole('textbox', { name: 'Add a subtask' })
    await user.type(field, 'Nope{Enter}')
    expect(await screen.findByText('Subtasks cannot nest that deep')).toBeVisible()
    expect(field).toHaveValue('Nope')
  })

  it('Escape with text clears the field and does not reach the detail', async () => {
    installFetch({ 'GET /api/v1/tasks': json({ items: [] }) })
    const user = userEvent.setup()
    let escapes = 0
    renderWithProviders(
      <div onKeyDown={(e) => e.key === 'Escape' && escapes++}>
        <SubtasksSection task={parent} statuses={statuses} />
      </div>,
    )
    const field = await screen.findByRole('textbox', { name: 'Add a subtask' })
    await user.type(field, 'draft{Escape}')
    expect(field).toHaveValue('')
    expect(escapes).toBe(0)
  })

  it('says so when the scan was capped', async () => {
    let calls = 0
    installFetch({
      'GET /api/v1/tasks': () => json({ items: [child(++calls)], nextCursor: `c${calls}` }),
    })
    renderSection()
    expect(
      await screen.findByText('Showing subtasks among the first 2,000 tasks of this List.'),
    ).toBeVisible()
  })

  it('a subtask links to its parent, and a hidden parent says so', async () => {
    installFetch({
      'GET /api/v1/tasks': json({ items: [] }),
      'GET /api/v1/tasks/:id': json({ ...parent, title: 'Launch plan' }),
    })
    const first = renderSection({ ...parent, id: 'c1', parentTaskId: 'p1' })
    expect(await screen.findByRole('link', { name: 'ACME-1 Launch plan' })).toHaveAttribute(
      'href',
      '/t/p1',
    )
    first.unmount()
    installFetch({
      'GET /api/v1/tasks': json({ items: [] }),
      'GET /api/v1/tasks/:id': problem(404, 'task.not_found', 'Not found'),
    })
    renderSection({ ...parent, id: 'c1', parentTaskId: 'p1' })
    expect(await screen.findByText('Subtask of a task you can’t see')).toBeVisible()
  })
})
