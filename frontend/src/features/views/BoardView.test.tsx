import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { BoardRenderer } from './BoardRenderer'
import { planDrop, targetFields } from './boardPlan'
import { baseRoutes, customFieldIds, fieldRoutes, scope, task } from './testSupport'

const t = (n: number, extra: Record<string, unknown> = {}) => task(n, extra) as unknown as TaskView

describe('BOARD-1 drop plan', () => {
  const cols = { todo: [t(1), t(2), t(3)], doing: [t(4)] }

  it('sends the neighbour ids and never a rank', () => {
    const plan = planDrop(cols, t(1), 'todo', 'doing', 't4', true)
    expect(plan).toMatchObject({ from: 'todo', to: 'doing', index: 0, body: { beforeId: 't4' } })
    expect(JSON.stringify(plan)).not.toMatch(/rank/i)
    const end = planDrop(cols, t(1), 'todo', 'doing', null, true)
    expect(end.body).toEqual({ afterId: 't4' })
  })

  it('moving down in a column lands after the card it was dropped on', () => {
    const plan = planDrop(cols, t(1), 'todo', 'todo', 't3', true)
    expect(plan.index).toBe(2)
    expect(plan.body).toEqual({ afterId: 't3' })
    const up = planDrop(cols, t(3), 'todo', 'todo', 't1', true)
    expect(up.index).toBe(0)
    expect(up.body).toEqual({ beforeId: 't1' })
  })

  it('a neighbour in another List or with another parent means keepRank', () => {
    const other = { todo: [t(1)], doing: [t(4, { listId: 'l2' })] }
    expect(planDrop(other, t(1), 'todo', 'doing', 't4', true).body).toEqual({ keepRank: true })
    const child = { todo: [t(1)], doing: [t(4, { parentTaskId: 'p' })] }
    expect(planDrop(child, t(1), 'todo', 'doing', 't4', true).body).toEqual({ keepRank: true })
    expect(planDrop(cols, t(1), 'todo', 'doing', 't4', false).body).toEqual({ keepRank: true })
  })

  it('names the target by group: status name, priority or the two assignees', () => {
    expect(targetFields('status', 'doing', 'todo', 'In progress')).toEqual({
      statusName: 'In progress',
    })
    expect(targetFields('priority', 'HIGH', 'LOW', 'High')).toEqual({ priority: 'HIGH' })
    expect(targetFields('assignee', 'u2', 'none', 'Omar')).toEqual({
      assigneeFrom: undefined,
      assigneeTo: 'u2',
    })
    expect(targetFields('assignee', 'none', 'u1', 'Unassigned')).toEqual({
      assigneeFrom: 'u1',
      assigneeTo: undefined,
    })
  })
})

type Cols = Record<string, ReturnType<typeof task>[]>

function serve(
  columns: Cols,
  move: (request: Request, body: unknown) => Response | Promise<Response>,
) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': (_r: Request, body: unknown) => {
      const { groupValue } = body as { groupValue?: string }
      if (groupValue) {
        return json({
          items: (columns[groupValue] ?? []).map((x) => ({ group: groupValue, task: x })),
        })
      }
      return json({
        items: [],
        groups: Object.entries(columns).map(([key, rows]) => ({
          key,
          label: key,
          count: rows.length,
        })),
      })
    },
    'POST /api/v1/tasks/:id/move': move,
  } as never)
}

const config = { v: 1, group: 'status', sort: [{ key: 'manual', dir: 'asc' }] }

/** A drag is driven by the keyboard: Space, an arrow, Space (laid out by a stubbed geometry). */
function layOut() {
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
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

describe('BOARD-1/2 Board view', () => {
  let restore = () => {}
  beforeEach(() => {
    restore = layOut()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => restore())

  async function keyboardDrop(title: string) {
    const user = userEvent.setup()
    const card = await screen
      .findByRole('button', { name: new RegExp(`${title}`) })
      .catch(() => null)
    const handle = card ?? screen.getByText(title).closest('li')!
    ;(handle as HTMLElement).focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(' ')
  }

  it('BOARD-1: a keyboard drop moves the card to the next column with the target and neighbours, and announces it', async () => {
    const stub = serve(
      {
        'to do': [t(1) as never, t(2) as never],
        'in progress': [t(4, { statusId: 'st-doing' }) as never],
      },
      () => json({ ...task(1), statusId: 'st-doing', version: 2 }),
    )
    renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await screen.findByText('Task 1')
    await screen.findByText('Task 4')

    await keyboardDrop('Task 1')

    await waitFor(() => expect(stub.calls.some((c) => c.url.pathname.endsWith('/move'))).toBe(true))
    const move = stub.calls.find((c) => c.url.pathname.endsWith('/move'))!
    expect(move.headers.get('If-Match')).toBe('"1"')
    expect(move.body).toMatchObject({ listId: 'l1', statusName: 'In progress' })
    expect(JSON.stringify(move.body)).not.toMatch(/rank"/)
    const body = move.body as Record<string, unknown>
    expect(body.beforeId === 't4' || body.afterId === 't4' || body.keepRank === true).toBe(true)
    // a screen-reader announcement is rendered in the live region
    await waitFor(() => expect(document.body.textContent).toMatch(/Task 1 was dropped in/))
  })

  it('BOARD-2: a 409 puts the card back in its original column and says why', async () => {
    serve({ 'to do': [t(1) as never], 'in progress': [] }, () =>
      problem(409, 'task.version_conflict', 'changed', { current: task(1, { version: 5 }) }),
    )
    renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await screen.findByText('Task 1')

    await keyboardDrop('Task 1')

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    const todo = screen.getByRole('region', { name: 'To do' })
    expect(todo).toHaveTextContent('Task 1')
  })

  it('BOARD-2: a 5xx puts the card back', async () => {
    serve({ 'to do': [t(1) as never], 'in progress': [] }, () =>
      problem(500, 'server.error', 'Boom'),
    )
    renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await screen.findByText('Task 1')
    await keyboardDrop('Task 1')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((x) => x.message)).toContain('Boom'),
    )
    expect(screen.getByRole('region', { name: 'To do' })).toHaveTextContent('Task 1')
  })
})

describe('FIELD-3 Board card chips (3A S4)', () => {
  const chipConfig = {
    ...config,
    columns: [
      { field: 'title' },
      { field: `cf:${customFieldIds.tier}` },
      { field: `cf:${customFieldIds.points}` },
    ],
  }

  it('a card shows a chip per filled custom field of the view columns, none for empty ones', async () => {
    installFetch({
      ...baseRoutes,
      ...fieldRoutes,
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        return groupValue === 'to do'
          ? json({
              items: [
                {
                  group: 'to do',
                  task: task(1, { customFields: { [customFieldIds.tier]: 'o-ent' } }),
                },
                { group: 'to do', task: task(2, { customFields: {} }) },
              ],
            })
          : json({ items: [], groups: [{ key: 'to do', label: 'To do', count: 2 }] })
      },
    } as never)
    renderWithProviders(<BoardRenderer scope={scope} config={chipConfig} />)

    const chip = await screen.findByLabelText('Customer tier: Enterprise')
    expect(chip).toBeVisible()
    expect(screen.queryByLabelText(/Story points/)).not.toBeInTheDocument()
    // Only the card with a value carries a chip.
    expect(screen.getAllByLabelText(/^Customer tier:/)).toHaveLength(1)
  })

  it('shows at most three chips and "+N" for the rest', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `3333333${i}-3333-4333-8333-333333333333`,
      name: `Field ${i}`,
      type: 'TEXT',
      config: {},
      options: [],
      definedAt: 's1',
      definedAtName: 'Engineering',
      inherited: true,
      hidden: false,
      version: 1,
    }))
    installFetch({
      ...baseRoutes,
      'GET /api/v1/locations/:id/fields': { locationId: 'l1', canEdit: true, fields: many },
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        return groupValue === 'to do'
          ? json({
              items: [
                {
                  group: 'to do',
                  task: task(1, {
                    customFields: Object.fromEntries(many.map((f, i) => [f.id, `v${i}`])),
                  }),
                },
              ],
            })
          : json({ items: [], groups: [{ key: 'to do', label: 'To do', count: 1 }] })
      },
    } as never)
    renderWithProviders(
      <BoardRenderer
        scope={scope}
        config={{
          ...config,
          columns: [{ field: 'title' }, ...many.map((f) => ({ field: `cf:${f.id}` }))],
        }}
      />,
    )

    expect(await screen.findByLabelText('Field 0: v0')).toBeVisible()
    expect(screen.getByLabelText('Field 2: v2')).toBeVisible()
    expect(screen.queryByLabelText('Field 3: v3')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeVisible()
  })
})
