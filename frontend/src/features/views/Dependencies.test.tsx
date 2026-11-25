import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { BoardRenderer } from './BoardRenderer'
import { CalendarRenderer } from './CalendarRenderer'
import { ListRenderer } from './ListRenderer'
import { TableRenderer } from './TableRenderer'
import { baseRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'
import { expectValue, findOption, pick } from '../../test/ui'

const blocked = (n: number, extra: Record<string, unknown> = {}) =>
  task(n, { blocked: true, blockerCount: 2, ...extra })

const deps = {
  waitingOn: [
    {
      dependencyId: 'd1',
      task: { id: 'b1', readableId: 'ACME-87', title: 'Fix login', finished: false },
    },
  ],
  blocking: [],
  linked: [],
  hiddenCount: { waitingOn: 0, blocking: 0, linked: 0 },
}

function serve(rows: ReturnType<typeof task>[], extra: Record<string, never> = {}) {
  return installFetch({
    ...baseRoutes,
    'GET /api/v1/tasks/:id/dependencies': () => json(deps),
    'POST /api/v1/views/query': () =>
      json({
        items: rows.map((t) => ({ group: 'to do', task: t })),
        groups: [{ key: 'to do', label: 'To do', count: rows.length }],
      }),
    'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
      json({ ...rows[0], ...(body as object), version: 2 }),
    ...extra,
  } as never)
}

const patches = (stub: ReturnType<typeof serve>) => stub.calls.filter((c) => c.method === 'PATCH')

describe('FR-10 the Blocked badge on every renderer', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [] })
    useToastStore.setState({ toasts: [] })
  })

  it('List: only the blocked row has the badge, named by its count', async () => {
    serve([blocked(1), task(2)])
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await screen.findByRole('link', { name: 'Task 1' })
    expect(screen.getAllByRole('img', { name: 'Blocked by 2 tasks' })).toHaveLength(1)
    const row = screen.getByRole('link', { name: 'Task 1' }).closest('[data-task-id]')!
    expect(
      within(row as HTMLElement).getByRole('img', { name: 'Blocked by 2 tasks' }),
    ).toBeVisible()
  })

  it('Table: the title cell has the badge', async () => {
    serve([blocked(1), task(2)])
    renderWithProviders(
      <TableRenderer
        scope={scope}
        config={{
          v: 1,
          columns: [
            { field: 'title', width: 300 },
            { field: 'status', width: 150 },
          ],
        }}
        update={vi.fn()}
      />,
    )
    await screen.findByRole('link', { name: 'Task 1' })
    expect(screen.getAllByRole('img', { name: /Blocked by/ })).toHaveLength(1)
  })

  it('Board: the card has the badge', async () => {
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        return groupValue
          ? json({ items: groupValue === 'to do' ? [{ group: groupValue, task: blocked(1) }] : [] })
          : json({ items: [], groups: [{ key: 'to do', label: 'To do', count: 1 }] })
      },
    } as never)
    renderWithProviders(
      <BoardRenderer scope={scope} config={{ v: 1, group: 'status' }} update={vi.fn()} />,
    )
    await screen.findByText('Task 1')
    expect(screen.getByRole('img', { name: 'Blocked by 2 tasks' })).toBeVisible()
  })

  it('Calendar: the chip has the icon-only badge', async () => {
    serve([blocked(1, { dueDate: '2026-11-25T00:00:00Z' })])
    renderWithProviders(
      <CalendarRenderer scope={scope} config={{ v: 1, mode: 'week' }} update={vi.fn()} />,
      {
        route: '/w/w1/l/l1/v/cal?m=week&d=2026-11-25',
      },
    )
    const cell = await screen.findByRole('gridcell', { name: '2026-11-25' })
    const badge = await within(cell).findByRole('img', { name: 'Blocked by 2 tasks' })
    expect(badge).toHaveTextContent('⛔')
    expect(badge).not.toHaveTextContent('Blocked')
  })
})

describe('FR-6 the inline status cell warns before completing a blocked task', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [] })
    useToastStore.setState({ toasts: [] })
  })

  it('List: Cancel sends nothing and the cell keeps its status; Complete anyway sends the change', async () => {
    const stub = serve([blocked(1)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    const select = await screen.findByLabelText('Status of ACME-1')
    await findOption(user, select, 'Done')

    await pick(user, select, 'Done')
    const dialog = await screen.findByRole('dialog', {
      name: 'Task 1 is waiting on 2 unfinished tasks',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(patches(stub)).toHaveLength(0)
    expectValue(screen.getByLabelText('Status of ACME-1'), 'To do')

    await pick(user, screen.getByLabelText('Status of ACME-1'), 'Done')
    await user.click(await screen.findByRole('button', { name: 'Complete anyway' }))
    await waitFor(() => expect(patches(stub)).toHaveLength(1))
    expect(patches(stub)[0].body).toEqual({ statusId: 'st-done' })
  })

  it('List: no dialog for a task that is not blocked, or for a change that does not complete', async () => {
    const stub = serve([task(1), blocked(2)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1, group: 'status' }} />)
    await findOption(user, await screen.findByLabelText('Status of ACME-1'), 'Done')
    await pick(user, await screen.findByLabelText('Status of ACME-1'), 'Done')
    await pick(user, screen.getByLabelText('Status of ACME-2'), 'In progress')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(patches(stub)).toHaveLength(2))
  })

  it('Table: Cancel sends nothing', async () => {
    const stub = serve([blocked(1)])
    const user = userEvent.setup()
    renderWithProviders(
      <TableRenderer
        scope={scope}
        config={{
          v: 1,
          columns: [
            { field: 'title', width: 300 },
            { field: 'status', width: 150 },
          ],
        }}
        update={vi.fn()}
      />,
    )
    const select = await screen.findByLabelText('Status of ACME-1')
    await findOption(user, select, 'Done')
    await pick(user, select, 'Done')
    await user.keyboard('{Escape}') // Escape cancels like the Cancel button
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patches(stub)).toHaveLength(0)
  })
})

describe('FR-6 a Board drop into a Done column', () => {
  let restore = () => {}
  beforeEach(() => {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const section = this.closest('section[aria-label]')
      if (this instanceof HTMLElement && this.tagName === 'SECTION') {
        const index = [...(this.parentElement?.children ?? [])].indexOf(this)
        return new DOMRect(index * 300, 0, 280, 600)
      }
      if (this instanceof HTMLElement && this.tagName === 'LI' && section) {
        const column = [...(section.parentElement?.children ?? [])].indexOf(section)
        const row = [...(this.parentElement?.children ?? [])].indexOf(this)
        return new DOMRect(column * 300 + 10, 40 + row * 60, 260, 50)
      }
      return new DOMRect(0, 0, 1000, 600)
    }
    restore = () => {
      Element.prototype.getBoundingClientRect = original
    }
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => restore())

  function serveBoard(card: ReturnType<typeof task>) {
    return installFetch({
      ...baseRoutes,
      'GET /api/v1/tasks/:id/dependencies': () => json(deps),
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        if (groupValue) {
          return json({ items: groupValue === 'to do' ? [{ group: groupValue, task: card }] : [] })
        }
        return json({
          items: [],
          groups: [
            { key: 'to do', label: 'To do', count: 1 },
            { key: 'in progress', label: 'In progress', count: 0 },
            { key: 'done', label: 'Done', count: 0 },
          ],
        })
      },
      'POST /api/v1/tasks/:id/move': () => json({ ...card, statusId: 'st-done', version: 2 }),
    } as never)
  }

  async function dropInDone() {
    const user = userEvent.setup()
    const handle = (await screen.findByText('Task 1')).closest('li') as HTMLElement
    handle.focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(' ')
    return user
  }

  const moves = (stub: ReturnType<typeof serveBoard>) =>
    stub.calls.filter((c) => c.url.pathname.endsWith('/move'))

  it('asks first; Cancel sends nothing and the card stays in its column', async () => {
    const stub = serveBoard(blocked(1))
    renderWithProviders(
      <BoardRenderer scope={scope} config={{ v: 1, group: 'status' }} update={vi.fn()} />,
    )
    const user = await (async () => {
      await screen.findByText('Task 1')
      return dropInDone()
    })()
    const dialog = await screen.findByRole('dialog', {
      name: 'Task 1 is waiting on 2 unfinished tasks',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(moves(stub)).toHaveLength(0)
    expect(within(screen.getByRole('region', { name: 'To do' })).getByText('Task 1')).toBeVisible()
  })

  it('Complete anyway sends the move', async () => {
    const stub = serveBoard(blocked(1))
    renderWithProviders(
      <BoardRenderer scope={scope} config={{ v: 1, group: 'status' }} update={vi.fn()} />,
    )
    await screen.findByText('Task 1')
    const user = await dropInDone()
    await user.click(await screen.findByRole('button', { name: 'Complete anyway' }))
    await waitFor(() => expect(moves(stub)).toHaveLength(1))
    expect(moves(stub)[0].body).toMatchObject({ statusName: 'Done' })
  })

  it('a card that is not blocked moves without a question', async () => {
    const stub = serveBoard(task(1))
    renderWithProviders(
      <BoardRenderer scope={scope} config={{ v: 1, group: 'status' }} update={vi.fn()} />,
    )
    await screen.findByText('Task 1')
    await dropInDone()
    await waitFor(() => expect(moves(stub)).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
