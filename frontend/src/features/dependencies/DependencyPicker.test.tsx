import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { DependencyPicker } from './DependencyPicker'

const task = {
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  title: 'Ship release',
  version: 3,
} as TaskView

const hits = {
  items: [
    { taskId: 't1', readableId: 'ACME-1', title: 'Ship release', listName: 'Rel' },
    { taskId: 'b7', readableId: 'ACME-7', title: 'Fix login redirect', listName: 'Eng' },
    { taskId: 'b8', readableId: 'ACME-8', title: 'Fix login copy', listName: 'Eng' },
  ],
}

function setup(routes: Record<string, never> = {}, related = new Set<string>()) {
  const stub = installFetch({
    'GET /api/v1/workspaces/:id/search': () => json(hits),
    ...routes,
  } as never)
  const onClose = vi.fn()
  const view = renderWithProviders(
    <DependencyPicker task={task} related={related} onClose={onClose} />,
  )
  view.queryClient.setQueryData(queryKeys.task('t1'), task)
  return { stub, onClose, ...view }
}

describe('FR-9 relationship picker', () => {
  it('excludes the task itself and tasks that are already related', async () => {
    const user = userEvent.setup()
    setup({}, new Set(['b8']))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    expect(await screen.findByRole('option', { name: /ACME-7/ })).toBeVisible()
    expect(screen.queryByRole('option', { name: /ACME-1 / })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /ACME-8/ })).not.toBeInTheDocument()
  })

  it('says "No tasks match." when nothing is left', async () => {
    const user = userEvent.setup()
    setup({ 'GET /api/v1/workspaces/:id/search': () => json({ items: [] }) } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'zzz')
    expect(await screen.findByText('No tasks match.')).toBeVisible()
  })

  it('looks a readable id up exactly and shows it first', async () => {
    const user = userEvent.setup()
    setup({
      'GET /api/v1/workspaces/:id/tasks/by-ref/:ref': () =>
        json({ id: 'b9', readableId: 'ACME-9', title: 'Exact one' }),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'acme-9')
    const options = await screen.findAllByRole('option')
    expect(options[0]).toHaveTextContent('ACME-9')
  })

  it('Enter adds the highlighted result with the chosen kind', async () => {
    const user = userEvent.setup()
    const { stub, onClose } = setup({
      'POST /api/v1/tasks/:id/dependencies': () =>
        json({ dependency: { id: 'd', relation: 'BLOCKING' }, task: { ...task, version: 4 } }, 201),
    } as never)
    await user.click(screen.getByRole('radio', { name: 'Blocking' }))
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await screen.findByRole('option', { name: /ACME-7/ })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const post = stub.calls.find(
      (c) => c.method === 'POST' && c.url.pathname.endsWith('/dependencies'),
    )!
    expect(post.body).toEqual({ otherTaskId: 'b7', relation: 'BLOCKING' })
  })

  it('Escape closes the picker', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('a refused loop names the path and stays open; hidden tasks are not named', async () => {
    const user = userEvent.setup()
    const { onClose } = setup({
      'POST /api/v1/tasks/:id/dependencies': () =>
        problem(409, 'dependency.cycle', 'loop', { path: ['t1', 'b7', null, 't1'] }),
      'GET /api/v1/tasks/:id': (request: Request) =>
        new URL(request.url).pathname.endsWith('/b7')
          ? json({ id: 'b7', readableId: 'ACME-7' })
          : json({ id: 't1', readableId: 'ACME-1' }),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This would make a loop: ACME-1 → ACME-7 → a task you can't see → ACME-1.",
    )
    expect(onClose).not.toHaveBeenCalled()
    // the input keeps its text
    expect(screen.getByRole('combobox', { name: 'Find a task' })).toHaveValue('login')
  })

  it.each([
    ['dependency.exists', 'These tasks are already related.'],
    ['dependency.limit', 'A task can have at most 100 relationships.'],
    ['task.not_found', "That task can't be found."],
    ['dependency.busy', 'These tasks are being changed right now. Try again.'],
  ])('a refused add (%s) shows its message in place', async (code, text) => {
    const user = userEvent.setup()
    setup({ 'POST /api/v1/tasks/:id/dependencies': () => problem(409, code, 'x') } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})
