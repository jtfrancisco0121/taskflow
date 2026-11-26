import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { Toaster } from '../../shared/ui/Toaster'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { scope, task } from './testSupport'
import { useTrashTasks } from './useTrashTasks'

function Harness({ batches, all }: { batches: object[][]; all: object[] }) {
  const { trash } = useTrashTasks(scope)
  return (
    <>
      {batches.map((batch, i) => (
        <button
          key={i}
          onClick={() => void trash(batch as unknown as TaskView[], all as unknown as TaskView[])}
        >{`Trash ${i + 1}`}</button>
      ))}
      <Toaster />
    </>
  )
}

const idOf = (url: URL, offset = 1) => url.pathname.split('/').at(-offset)!
const messages = () => useToastStore.getState().toasts.map((t) => t.message)

function serve(extra: Record<string, unknown> = {}) {
  return installFetch({
    'DELETE /api/v1/tasks/:id': new Response(null, { status: 204 }),
    'POST /api/v1/tasks/:id/restore': (r: Request) =>
      json(task(Number(idOf(new URL(r.url), 2).slice(1)))),
    ...extra,
  } as never)
}

describe('useTrashTasks (AD-4)', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('trashes with If-Match, shows one Undo toast, and Undo restores with version + 1', async () => {
    const stub = serve()
    const user = userEvent.setup()
    const rows = [task(1, { version: 4 }), task(2, { version: 7 })]
    renderWithProviders(<Harness batches={[rows]} all={rows} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    expect(await screen.findByText('Moved 2 tasks to trash.')).toBeVisible()
    expect(
      stub.calls.filter((c) => c.method === 'DELETE').map((c) => c.headers.get('If-Match')),
    ).toEqual(['"4"', '"7"'])
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(messages()).toContain('Restored 2 tasks.'))
    expect(
      stub.calls
        .filter((c) => c.url.pathname.endsWith('/restore'))
        .map((c) => c.headers.get('If-Match')),
    ).toEqual(['"5"', '"8"'])
  })

  it('names the tasks that were not deleted and trashes the rest', async () => {
    serve({
      'DELETE /api/v1/tasks/:id': (r: Request) =>
        idOf(new URL(r.url)) === 't2'
          ? problem(409, 'task.version_conflict', 'changed')
          : new Response(null, { status: 204 }),
    })
    const user = userEvent.setup()
    const rows = [task(1), task(2), task(3)]
    renderWithProviders(<Harness batches={[rows]} all={rows} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    await waitFor(() => expect(messages()).toContain('Not deleted: ACME-2'))
    expect(await screen.findByText('Moved 2 tasks to trash.')).toBeVisible()
  })

  it('reports a restore that failed', async () => {
    serve({ 'POST /api/v1/tasks/:id/restore': problem(409, 'task.version_conflict', 'changed') })
    const user = userEvent.setup()
    const rows = [task(1)]
    renderWithProviders(<Harness batches={[rows]} all={rows} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(messages()).toContain('1 task could not be restored.'))
  })

  it('a second trash inside the undo window merges into one toast and one Undo restores both', async () => {
    const stub = serve()
    const user = userEvent.setup()
    const a = [task(1)]
    const b = [task(2)]
    renderWithProviders(<Harness batches={[a, b]} all={[...a, ...b]} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    await screen.findByText('Moved 1 task to trash.')
    await user.click(screen.getByRole('button', { name: 'Trash 2' }))
    expect(await screen.findByText('Moved 2 tasks to trash.')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(messages()).toContain('Restored 2 tasks.'))
    expect(stub.calls.filter((c) => c.url.pathname.endsWith('/restore'))).toHaveLength(2)
  })

  it('a parent and its subtask selected together send one DELETE, report no failure, and Undo restores the parent', async () => {
    const stub = serve()
    const user = userEvent.setup()
    const parent = task(1)
    const child = task(2, { parentTaskId: 't1' })
    renderWithProviders(<Harness batches={[[parent, child]]} all={[parent, child]} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    expect(await screen.findByText('Moved 2 tasks to trash.')).toBeVisible()
    expect(stub.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(messages().some((m) => m.startsWith('Not deleted'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(messages()).toContain('Restored 2 tasks.'))
    expect(stub.calls.filter((c) => c.url.pathname.endsWith('/restore'))).toHaveLength(1)
  })

  it('a merged window holding child then parent restores the parent first and both succeed', async () => {
    const trashed = new Set<string>()
    const stub = serve({
      'DELETE /api/v1/tasks/:id': (r: Request) => {
        trashed.add(idOf(new URL(r.url)))
        return new Response(null, { status: 204 })
      },
      'POST /api/v1/tasks/:id/restore': (r: Request) => {
        const id = idOf(new URL(r.url), 2)
        if (id === 't2' && trashed.has('t1'))
          return problem(409, 'task.parent_trashed', 'Restore the parent task first')
        trashed.delete(id)
        return json(task(Number(id.slice(1))))
      },
    })
    const user = userEvent.setup()
    const parent = task(1)
    const child = task(2, { parentTaskId: 't1' })
    renderWithProviders(<Harness batches={[[child], [parent]]} all={[parent, child]} />)
    await user.click(screen.getByRole('button', { name: 'Trash 1' }))
    await screen.findByText('Moved 1 task to trash.')
    await user.click(screen.getByRole('button', { name: 'Trash 2' }))
    await screen.findByText('Moved 2 tasks to trash.')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(messages()).toContain('Restored 2 tasks.'))
    expect(
      stub.calls.filter((c) => c.url.pathname.endsWith('/restore')).map((c) => idOf(c.url, 2)),
    ).toEqual(['t1', 't2'])
  })
})
