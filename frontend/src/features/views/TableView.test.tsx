import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { baseRoutes, customFieldIds, fieldRoutes, scope, task } from './testSupport'
import { clampWidth, dropColumn, moveColumn, toggleColumn, withWidth } from './tableColumns'
import { TableRenderer } from './TableRenderer'
import { expectValue, open, pick } from '../../test/ui'

describe('TABLE-1 column model', () => {
  const columns = [
    { field: 'title', width: 300 },
    { field: 'status', width: 150 },
    { field: 'tags' },
  ]

  it('clamps a width to 60..800', () => {
    expect(clampWidth(10)).toBe(60)
    expect(clampWidth(5000)).toBe(800)
    expect(clampWidth(333.4)).toBe(333)
    expect(withWidth(columns, 'status', 20)[1].width).toBe(60)
    expect(withWidth(columns, 'status', 900)[1].width).toBe(800)
  })

  it('moves a column by one place or onto another, and never hides the title', () => {
    expect(moveColumn(columns, 'status', 1).map((c) => c.field)).toEqual([
      'title',
      'tags',
      'status',
    ])
    expect(moveColumn(columns, 'title', -1)).toEqual(columns)
    expect(dropColumn(columns, 'tags', 'title').map((c) => c.field)).toEqual([
      'tags',
      'title',
      'status',
    ])
    expect(toggleColumn(columns, 'title', false)).toEqual(columns)
    expect(toggleColumn(columns, 'status', false).map((c) => c.field)).toEqual(['title', 'tags'])
    expect(toggleColumn(columns, 'dueDate', true).map((c) => c.field)).toEqual([
      'title',
      'status',
      'tags',
      'dueDate',
    ])
  })
})

function serve(rows: ReturnType<typeof task>[], patch?: (r: Request, body: unknown) => Response) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () => json({ items: rows.map((t) => ({ task: t })) }),
    'PATCH /api/v1/tasks/:id':
      patch ??
      ((_r: Request, body: unknown) => json({ ...rows[0], ...(body as object), version: 2 })),
  } as never)
}

const config = {
  v: 1,
  columns: [
    { field: 'readableId', width: 100 },
    { field: 'title', width: 300 },
    { field: 'status', width: 150 },
    { field: 'priority', width: 120 },
    { field: 'dueDate', width: 150 },
    { field: 'tags', width: 150 },
    { field: 'createdAt', width: 150 },
  ],
}

describe('TABLE-1 Table view', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('TABLE-1: Alt+Arrow moves a column and Alt+Shift+Arrow resizes it, both written to c at once', async () => {
    serve([task(1)])
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={update} />)

    const status = await screen.findByRole('button', { name: /^Status column/ })
    status.focus()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(update.mock.lastCall![0].c.map((c: { field: string }) => c.field)).toEqual([
      'readableId',
      'title',
      'priority',
      'status',
      'dueDate',
      'tags',
      'createdAt',
    ])
    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}')
    expect(
      update.mock.lastCall![0].c.find((c: { field: string }) => c.field === 'status').width,
    ).toBe(170)
    // far past the limit: the width stays 800
    const wide = {
      ...config,
      columns: config.columns.map((c) => (c.field === 'status' ? { ...c, width: 800 } : c)),
    }
    update.mockClear()
    renderWithProviders(<TableRenderer scope={scope} config={wide} update={update} />)
    const widest = (await screen.findAllByRole('button', { name: /^Status column, width 800/ }))[0]
    widest.focus()
    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}')
    expect(
      update.mock.lastCall![0].c.find((c: { field: string }) => c.field === 'status').width,
    ).toBe(800)
  })

  it('TABLE-1: the title column cannot be hidden', async () => {
    serve([task(1)])
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={vi.fn()} />)
    await user.click(await screen.findByText('Columns'))
    expect(screen.getByRole('checkbox', { name: 'Title' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Status' })).toBeEnabled()
  })

  it('TABLE-1: each editable cell edits in place and sends If-Match; Escape cancels', async () => {
    const rows = [task(1, { version: 3 })]
    const stub = serve(rows)
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={vi.fn()} />)
    await screen.findByRole('link', { name: 'Task 1' })

    await pick(user, screen.getByLabelText('Priority of ACME-1'), 'Urgent')
    await pick(user, await screen.findByLabelText('Status of ACME-1'), 'In progress')
    await user.click(screen.getByRole('button', { name: 'Edit Tags of ACME-1' }))
    await user.type(screen.getByRole('textbox', { name: 'Tags of ACME-1' }), 'a, b{Enter}')
    await user.type(screen.getByLabelText('Due date of ACME-1'), '2026-12-24')
    await user.click(screen.getByRole('button', { name: 'Edit Title of ACME-1' }))
    await user.type(screen.getByRole('textbox', { name: 'Title of ACME-1' }), 'nope{Escape}')

    await waitFor(() =>
      expect(stub.calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThanOrEqual(4),
    )
    const bodies = stub.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)
    expect(bodies).toContainEqual({ priority: 'URGENT' })
    expect(bodies).toContainEqual({ statusId: 'st-doing' })
    expect(bodies).toContainEqual({ tags: ['a', 'b'] })
    expect(bodies).toContainEqual({ dueDate: '2026-12-24T00:00:00Z' })
    expect(
      stub.calls.filter((c) => c.method === 'PATCH').every((c) => c.headers.get('If-Match')),
    ).toBe(true)
    expect(bodies.some((b) => 'title' in (b as object))).toBe(false)
  })

  it('TABLE-1: read-only cells (ID, created) open nothing', async () => {
    serve([task(1, { createdAt: '2026-01-02T03:04:00Z' })])
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={vi.fn()} />)
    const row = (await screen.findByRole('link', { name: 'Task 1' })).closest(
      '[role="row"]',
    ) as HTMLElement
    await user.click(within(row).getByText('ACME-1'))
    await user.dblClick(within(row).getByText(/Jan 2, 2026/))
    expect(within(row).queryByLabelText(/created|ID of/i)).not.toBeInTheDocument()
    expect(within(row).queryAllByRole('textbox')).toHaveLength(0)
  })

  it('TABLE-1: a 409 behaves as in the List: notice and the server task', async () => {
    const rows = [task(1)]
    serve(rows, () => {
      rows[0] = task(1, { priority: 'LOW', version: 8 })
      return problem(409, 'task.version_conflict', 'changed', { current: rows[0] })
    })
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={vi.fn()} />)
    await screen.findByRole('link', { name: 'Task 1' })
    await pick(user, screen.getByLabelText('Priority of ACME-1'), 'Urgent')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    await waitFor(() => expectValue(screen.getByLabelText('Priority of ACME-1'), 'Low'))
  })
})

describe('FIELD-3 custom field columns (3A S4)', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  const withTier = {
    ...config,
    columns: [...config.columns, { field: `cf:${customFieldIds.tier}`, width: 160 }],
  }

  function serveFields(
    rows: ReturnType<typeof task>[],
    patch?: (r: Request, body: unknown) => Response,
  ) {
    return installFetch({
      ...baseRoutes,
      ...fieldRoutes,
      'POST /api/v1/views/query': () => json({ items: rows.map((t) => ({ task: t })) }),
      'PATCH /api/v1/tasks/:id':
        patch ??
        ((_r: Request, body: unknown) => json({ ...rows[0], ...(body as object), version: 2 })),
    } as never)
  }

  it('FIELD-3: a Dropdown cell is edited inline, saved with If-Match and shown at once', async () => {
    const rows = [task(1, { version: 3, customFields: {} })]
    const stub = serveFields(rows, (_r, body) => {
      const { customFields: sent } = body as { customFields: Record<string, string> }
      rows[0] = task(1, { version: 4, customFields: sent })
      return json(rows[0])
    })
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={withTier} update={vi.fn()} />)

    const cell = await screen.findByRole('button', { name: 'Customer tier: empty' })
    await user.click(cell)
    await pick(user, screen.getByLabelText('Customer tier for ACME-1'), 'Enterprise')

    expect(await screen.findByRole('button', { name: 'Customer tier: Enterprise' })).toBeVisible()
    const patch = stub.calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ customFields: { [customFieldIds.tier]: 'o-ent' } })
    expect(patch.headers.get('If-Match')).toBe('"3"')
  })

  it('FIELD-3: a Dropdown cell stays in edit mode while its listbox is open, and Escape closes one layer at a time (AD-12)', async () => {
    const stub = serveFields([task(1, { customFields: {} })])
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={withTier} update={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Customer tier: empty' }))
    await open(user, screen.getByLabelText('Customer tier for ACME-1'))
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

  it('FIELD-3: a 409 rolls the cell back to the server value and toasts', async () => {
    const rows = [task(1, { version: 3, customFields: { [customFieldIds.tier]: 'o-free' } })]
    serveFields(rows, () => {
      rows[0] = task(1, { version: 9, customFields: { [customFieldIds.tier]: 'o-ent' } })
      return problem(409, 'task.version_conflict', 'changed', { current: rows[0] })
    })
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={withTier} update={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Customer tier: Free' }))
    await pick(user, screen.getByLabelText('Customer tier for ACME-1'), '—')

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    expect(await screen.findByRole('button', { name: 'Customer tier: Enterprise' })).toBeVisible()
  })

  it('FIELD-3: a refused value (400) rolls back and shows the server message', async () => {
    const rows = [task(1, { version: 3, customFields: { [customFieldIds.points]: 2 } })]
    serveFields(rows, () => problem(400, 'field.invalid_value', 'Story points expects a number'))
    const user = userEvent.setup()
    const points = {
      ...config,
      columns: [...config.columns, { field: `cf:${customFieldIds.points}`, width: 160 }],
    }
    renderWithProviders(<TableRenderer scope={scope} config={points} update={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Story points: 2' }))
    const box = screen.getByRole('textbox', { name: 'Story points for ACME-1' })
    await user.clear(box)
    await user.type(box, 'abc{Enter}')

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Story points expects a number',
      ),
    )
    expect(await screen.findByRole('button', { name: 'Story points: 2' })).toBeVisible()
  })

  it('Escape cancels the editor and sends nothing', async () => {
    const stub = serveFields([task(1, { customFields: {} })])
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={withTier} update={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Customer tier: empty' }))
    await user.keyboard('{Escape}')

    expect(await screen.findByRole('button', { name: 'Customer tier: empty' })).toBeVisible()
    expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('the Columns picker lists the custom fields with where they come from and adds cf:<id> to c', async () => {
    serveFields([task(1)])
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<TableRenderer scope={scope} config={config} update={update} />)

    await user.click(await screen.findByText('Columns'))
    expect(await screen.findAllByText('from Engineering')).toHaveLength(2)
    await user.click(screen.getByRole('checkbox', { name: /Customer tier/ }))
    expect(update.mock.lastCall![0].c.map((c: { field: string }) => c.field)).toContain(
      `cf:${customFieldIds.tier}`,
    )
  })

  it('an empty cell has the accessible name "empty" and the header shows the field name', async () => {
    serveFields([task(1, { customFields: {} })])
    renderWithProviders(<TableRenderer scope={scope} config={withTier} update={vi.fn()} />)
    expect(await screen.findByRole('columnheader', { name: /Customer tier/ })).toBeVisible()
    expect(await screen.findByText('empty')).toBeInTheDocument()
  })
})
