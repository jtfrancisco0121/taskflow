import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { runLimited } from './bulk'
import { ListRenderer } from './ListRenderer'
import { baseRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'

const rows = () => Array.from({ length: 50 }, (_, i) => task(i + 1))

function serve(tasks: ReturnType<typeof task>[], extra: Record<string, unknown> = {}) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () =>
      json({
        items: tasks.map((t) => ({ group: 'to do', task: t })),
        groups: [{ key: 'to do', label: 'To do', count: tasks.length }],
      }),
    ...extra,
  } as never)
}

describe('LIST-1 Bulk actions', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [] })
    useToastStore.setState({ toasts: [] })
  })

  it('runLimited never has more than 6 in flight and keeps every result in order', async () => {
    let inFlight = 0
    let peak = 0
    const results = await runLimited(
      Array.from({ length: 50 }, (_, i) => i),
      async (n) => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 2))
        inFlight--
        return n * 2
      },
      6,
    )
    expect(peak).toBe(6)
    expect(results.map((r) => r.result)).toEqual(Array.from({ length: 50 }, (_, i) => i * 2))
  })

  it('LIST-1: 50 tasks, at most 6 requests at once, failures named by readable id', async () => {
    let inFlight = 0
    let peak = 0
    const stub = serve(rows(), {
      'PATCH /api/v1/tasks/:id': async (request: Request, body: unknown) => {
        peak = Math.max(peak, ++inFlight)
        await new Promise((r) => setTimeout(r, 3))
        inFlight--
        const id = new URL(request.url).pathname.split('/').pop()!
        if (id === 't3') return problem(500, 'server.error', 'Boom')
        if (id === 't9') {
          return problem(409, 'task.version_conflict', 'changed', {
            current: task(9, { version: 7 }),
          })
        }
        return json({ ...task(Number(id.slice(1)), { version: 2 }), ...(body as object) })
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await screen.findByRole('link', { name: 'Task 1' })
    useViewStore.setState({ selected: Array.from({ length: 50 }, (_, i) => `t${i + 1}`) })

    await user.selectOptions(await screen.findByLabelText('Set priority'), 'HIGH')

    await waitFor(() => expect(stub.calls.filter((c) => c.method === 'PATCH')).toHaveLength(50))
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
    await waitFor(() => {
      const messages = useToastStore.getState().toasts.map((t) => t.message)
      const summary = messages.find((m) => m.startsWith('Priority: 48 of 50'))
      expect(summary).toContain('ACME-3 (could not be saved)')
      expect(summary).toContain('ACME-9 (changed by someone else)')
    })
    // per-task toasts are off during a fan-out: one summary only
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('LIST-1: Delete removes the selected tasks and Undo restores them with the new version', async () => {
    const stub = serve([task(1), task(2), task(3)], {
      'DELETE /api/v1/tasks/:id': new Response(null, { status: 204 }),
      'POST /api/v1/tasks/:id/restore': (request: Request) =>
        json(task(Number(new URL(request.url).pathname.split('/').at(-2)!.slice(1)))),
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await screen.findByRole('link', { name: 'Task 1' })
    useViewStore.setState({ selected: ['t1', 't2', 't3'] })

    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/Deleted 3 tasks/)).toBeVisible()
    expect(
      stub.calls.filter((c) => c.method === 'DELETE').map((c) => c.headers.get('If-Match')),
    ).toEqual(['"1"', '"1"', '"1"'])

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(stub.calls.filter((c) => c.url.pathname.endsWith('/restore'))).toHaveLength(3),
    )
    // the restore carries the version the delete produced
    expect(
      stub.calls
        .filter((c) => c.url.pathname.endsWith('/restore'))
        .map((c) => c.headers.get('If-Match')),
    ).toEqual(['"2"', '"2"', '"2"'])
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Restored 3 tasks.'),
    )
  })
})
