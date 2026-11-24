import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { baseRoutes, scope, task } from './testSupport'
import { clampWidth, dropColumn, moveColumn, toggleColumn, withWidth } from './tableColumns'
import { TableRenderer } from './TableRenderer'

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

    await user.selectOptions(screen.getByLabelText('Priority of ACME-1'), 'URGENT')
    await user.selectOptions(await screen.findByLabelText('Status of ACME-1'), 'st-doing')
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
    await user.selectOptions(screen.getByLabelText('Priority of ACME-1'), 'URGENT')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Priority of ACME-1')).toHaveDisplayValue('Low'),
    )
  })
})
