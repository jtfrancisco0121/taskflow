import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ListRenderer } from './ListRenderer'
import { baseRoutes, customFieldIds, fieldRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'
import { useLocation } from 'react-router'
import { expectValue, open, pick, valueOf } from '../../test/ui'

const grouped = { v: 1, group: 'status' }

function serve(tasks: ReturnType<typeof task>[], extra: Record<string, never> = {}) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () =>
      json({
        items: tasks.map((t) => ({ group: 'to do', task: t })),
        groups: [{ key: 'to do', label: 'To do', count: tasks.length }],
      }),
    ...extra,
  })
}

describe('LIST-1 List view', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [] })
    useToastStore.setState({ toasts: [] })
  })

  it('LIST-1: 5,000 loaded rows render at most 200 rows in the DOM', async () => {
    serve(Array.from({ length: 5000 }, (_, i) => task(i + 1)))
    const { container } = renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    await screen.findByRole('link', { name: 'Task 1' })
    const rows = container.querySelectorAll('[data-task-id]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(200)
    expect(screen.getByRole('table', { name: 'Tasks' })).toHaveAttribute('aria-rowcount', '5001')
  })

  it('LIST-1: collapsing a group hides its rows and keeps the header count', async () => {
    serve([task(1), task(2), task(3)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    const header = await screen.findByRole('button', { name: /To do/ })
    expect(header).toHaveTextContent('3')
    await user.click(header)
    expect(screen.queryByRole('link', { name: 'Task 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /To do/ })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: /To do/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('LIST-1: an inline edit sends If-Match with the cached version', async () => {
    const stub = serve([task(1, { version: 4 })], {
      'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
        json({ ...task(1, { version: 5 }), ...(body as object) }),
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    await screen.findByRole('link', { name: 'Task 1' })
    await user.click(screen.getByRole('button', { name: 'Edit Title of ACME-1' }))
    const input = screen.getByRole('textbox', { name: 'Title of ACME-1' })
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = stub.calls.find((c) => c.method === 'PATCH')!
    expect(patch.headers.get('If-Match')).toBe('"4"')
    expect(patch.body).toEqual({ title: 'Renamed' })
    expect(await screen.findByRole('link', { name: 'Renamed' })).toBeVisible()
  })

  it('LIST-1: Escape cancels an inline edit and sends nothing', async () => {
    const stub = serve([task(1)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    await screen.findByRole('link', { name: 'Task 1' })
    await user.click(screen.getByRole('button', { name: 'Edit Title of ACME-1' }))
    await user.type(screen.getByRole('textbox', { name: 'Title of ACME-1' }), 'zzz{Escape}')

    expect(screen.getByRole('link', { name: 'Task 1' })).toBeVisible()
    expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('LIST-1: a 409 shows the notice and the server version of the task', async () => {
    const rows = [task(1)]
    serve(rows, {
      'PATCH /api/v1/tasks/:id': () => {
        // the server's task now differs; the refetch after the conflict shows it too
        rows[0] = task(1, { title: 'Changed elsewhere', version: 9 })
        return problem(409, 'task.version_conflict', 'changed', { current: rows[0] })
      },
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    await screen.findByRole('link', { name: 'Task 1' })
    await pick(user, screen.getByLabelText('Priority of ACME-1'), 'Urgent')

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    expect(await screen.findByRole('link', { name: 'Changed elsewhere' })).toBeVisible()
    expectValue(within(screen.getByRole('table')).getByLabelText('Priority of ACME-1'), 'Normal')
  })

  it('LIST-1: a Bulk action bar appears with a selection and sets the priority of every row', async () => {
    const rows = [task(1), task(2), task(3)]
    const stub = serve(rows, {
      'PATCH /api/v1/tasks/:id': (r: Request, body: unknown) => {
        const row = rows.find((t) => r.url.endsWith(`/${t.id}`))!
        Object.assign(row, body, { version: row.version + 1 })
        return json(row)
      },
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)

    await screen.findByRole('link', { name: 'Task 1' })
    for (const n of [1, 2, 3])
      await user.click(screen.getByRole('checkbox', { name: `Select Task ${n}` }))
    await pick(user, screen.getByLabelText('Set priority'), 'High')

    await waitFor(() => expect(stub.calls.filter((c) => c.method === 'PATCH')).toHaveLength(3))
    await waitFor(() =>
      expect(screen.getAllByLabelText(/^Priority of ACME-/).map((el) => valueOf(el))).toEqual([
        'High',
        'High',
        'High',
      ]),
    )
  })

  it('FIELD-3: a custom field column is drawn and a cell is edited inline', async () => {
    const stub = serve(
      [task(1, { version: 2, customFields: { [customFieldIds.tier]: 'o-free' } })],
      {
        ...fieldRoutes,
        'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
          json({ ...task(1, { version: 3 }), ...(body as object) }),
      } as never,
    )
    const user = userEvent.setup()
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{
          ...grouped,
          columns: [{ field: 'title' }, { field: `cf:${customFieldIds.tier}` }],
        }}
      />,
    )

    expect(await screen.findByRole('columnheader', { name: /Customer tier/ })).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Customer tier: Free' }))
    await pick(user, screen.getByLabelText('Customer tier for ACME-1'), 'Enterprise')

    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = stub.calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ customFields: { [customFieldIds.tier]: 'o-ent' } })
    expect(patch.headers.get('If-Match')).toBe('"2"')
  })

  it('FIELD-3: a Dropdown cell stays in edit mode while its listbox is open, and Escape closes one layer at a time (AD-12)', async () => {
    const stub = serve([task(1, { customFields: {} })], {
      ...fieldRoutes,
      'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
        json({ ...task(1, { version: 3 }), ...(body as object) }),
    } as never)
    const user = userEvent.setup()
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{
          ...grouped,
          columns: [{ field: 'title' }, { field: `cf:${customFieldIds.tier}` }],
        }}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Customer tier: empty' }))
    const trigger = screen.getByLabelText('Customer tier for ACME-1')
    await open(user, trigger)
    // Focus is in the portalled listbox: the editor must not unmount.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByLabelText('Customer tier for ACME-1')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Customer tier for ACME-1')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: 'Customer tier: empty' })).toBeVisible()
    expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('AD-12: picking a status in a row sends the change and does not open the task', async () => {
    const stub = serve([task(1, { version: 2 })], {
      'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
        json({ ...task(1, { version: 3 }), ...(body as object) }),
    } as never)
    const user = userEvent.setup()
    function Where() {
      return <output data-testid="where">{useLocation().pathname}</output>
    }
    renderWithProviders(
      <>
        <ListRenderer scope={scope} config={grouped} />
        <Where />
      </>,
      { route: '/w/w1/l/l1' },
    )
    const status = await screen.findByLabelText('Status of ACME-1')
    await pick(user, status, 'Done')
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/l1')
    expect(screen.getByTestId('where')).not.toHaveTextContent('/t/')
  })

  it('FIELD-3: a filter that matches nothing says so and offers Clear filters', async () => {
    serve([])
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{
          v: 1,
          filter: { op: 'AND', items: [{ field: 'title', op: 'contains', value: 'x' }] },
        }}
        update={update}
      />,
    )

    expect(await screen.findByText('No tasks match these filters.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(update).toHaveBeenCalledWith({ f: { op: 'AND', items: [] } })
  })

  it('FIELD-3: dropped fields are named with a way to remove them from the view', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () =>
        json({
          items: [{ group: 'to do', task: task(1) }],
          groups: [{ key: 'to do', label: 'To do', count: 1 }],
          droppedFields: [{ ref: `cf:${id}`, name: 'Story points' }],
        }),
    } as never)
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{ ...grouped, filter: { op: 'AND', items: [{ field: `cf:${id}`, op: 'is_set' }] } }}
        update={update}
      />,
    )

    expect(
      await screen.findByText(
        'Some filters were removed because a field was deleted: Story points.',
      ),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove from view' }))
    expect(update.mock.lastCall![0].f).toEqual({ op: 'AND', items: [] })
  })

  it('shows an error with Retry when the tasks cannot load', async () => {
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': problem(500, 'internal.error', 'The request failed'),
    } as never)
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The request failed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })

  it('CAP-9: loading shows six skeleton rows in a status', async () => {
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () => new Promise<Response>(() => {}),
    })
    renderWithProviders(<ListRenderer scope={scope} config={grouped} />)
    expect(await screen.findByRole('status', { name: 'Loading tasks' })).toBeVisible()
  })

  it('CAP-9: an empty List shows the empty text', async () => {
    serve([])
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{ v: 1 }}
        empty="No tasks yet. Type a title below to add one."
      />,
    )
    expect(await screen.findByText('No tasks yet. Type a title below to add one.')).toBeVisible()
  })

  it('CAP-9: a filter that matches nothing offers Clear filters', async () => {
    serve([])
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ListRenderer
        scope={scope}
        config={{
          v: 1,
          filter: { op: 'AND', items: [{ field: 'title', op: 'contains', value: 'zzz' }] },
        }}
        update={update}
      />,
    )
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }))
    expect(update).toHaveBeenCalledWith({ f: { op: 'AND', items: [] } })
  })

  it('CAP-9: a failed load shows the server message and Retry loads again', async () => {
    let fail = true
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () =>
        fail
          ? problem(500, 'server.error', 'The server is down')
          : json({ items: [{ task: task(1) }] }),
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is down')
    fail = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()
  })
})
