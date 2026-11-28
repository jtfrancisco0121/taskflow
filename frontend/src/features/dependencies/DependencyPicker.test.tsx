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

  it('a second pick while an add is pending sends no request (ClickUp 14yq6g33592)', async () => {
    const user = userEvent.setup()
    let answer: (r: Response) => void = () => {}
    const { stub, onClose } = setup({
      'POST /api/v1/tasks/:id/dependencies': () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    await user.click(screen.getByRole('option', { name: /ACME-8/ }))
    await user.keyboard('{Enter}')
    const posts = () =>
      stub.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/dependencies'))
    expect(posts()).toHaveLength(1)
    expect(screen.getByRole('option', { name: /ACME-8/ })).toHaveAttribute('aria-disabled', 'true')
    answer(
      json({ dependency: { id: 'd', relation: 'WAITING_ON' }, task: { ...task, version: 4 } }, 201),
    )
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(posts()).toHaveLength(1)
  })

  it('a pick is allowed again once a refused add has settled', async () => {
    const user = userEvent.setup()
    const { stub } = setup({
      'POST /api/v1/tasks/:id/dependencies': () =>
        problem(409, 'dependency.exists', 'These two tasks are already related'),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('option', { name: /ACME-8/ }))
    await waitFor(() =>
      expect(
        stub.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/dependencies')),
      ).toHaveLength(2),
    )
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
  ])('a refused add (%s) shows its message in place', async (code, text) => {
    const user = userEvent.setup()
    setup({ 'POST /api/v1/tasks/:id/dependencies': () => problem(409, code, 'x') } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  // ClickUp 14yq6g334u1: lock contention is 503 request.busy with Retry-After, as everywhere else.
  const busy = (retryAfter: string) =>
    new Response(
      JSON.stringify({
        status: 503,
        code: 'request.busy',
        title: 'x',
        detail: 'The server is busy',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/problem+json', 'Retry-After': retryAfter },
      },
    )

  it('a busy add is retried once after Retry-After, with the same key, and succeeds', async () => {
    const user = userEvent.setup()
    let n = 0
    const { stub, onClose } = setup({
      'POST /api/v1/tasks/:id/dependencies': () =>
        ++n === 1
          ? busy('1')
          : json({ dependency: { id: 'd1' }, task: { ...task, version: 4 } }, 201),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    const started = Date.now()
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 3_000 })
    const posts = stub.calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(posts[1].headers.get('Idempotency-Key')).toBe(posts[0].headers.get('Idempotency-Key'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a busy retry shows the busy message, not a generic error, and stops there', async () => {
    const user = userEvent.setup()
    const { stub, onClose } = setup({
      'POST /api/v1/tasks/:id/dependencies': () => busy('0'),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'These tasks are being changed right now. Try again.',
    )
    expect(stub.count('POST', /dependencies$/)).toBe(2)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a real 409 is not retried', async () => {
    const user = userEvent.setup()
    const { stub } = setup({
      'POST /api/v1/tasks/:id/dependencies': () => problem(409, 'dependency.exists', 'x'),
    } as never)
    await user.type(screen.getByRole('combobox', { name: 'Find a task' }), 'login')
    await user.click(await screen.findByRole('option', { name: /ACME-7/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('These tasks are already related.')
    expect(stub.count('POST', /dependencies$/)).toBe(1)
  })
})
