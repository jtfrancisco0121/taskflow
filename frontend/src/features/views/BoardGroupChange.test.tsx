import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { BoardRenderer } from './BoardRenderer'
import { baseRoutes, expectColumnCountsMatchCards, scope, task } from './testSupport'
import { useTaskActions } from './useTaskActions'

// 14yq6g334tg: a status change elsewhere (the List's status pick) while the Board is open or opening. The Board's
// counts and cards must agree, and the task must end in the column of its new status.

type Row = ReturnType<typeof task>
const STATUS_KEY: Record<string, string> = { 'st-todo': 'to do', 'st-doing': 'in progress' }

/** A tiny server: tasks by id, grouped by status; `hold` lets a test pick when a response leaves. */
function server(rows: Row[]) {
  const db = new Map(rows.map((r) => [r.id, { ...r }]))
  const column = (key: string) => [...db.values()].filter((r) => STATUS_KEY[r.statusId] === key)
  const groups = () =>
    ['to do', 'in progress']
      .map((key) => ({ key, label: key, count: column(key).length }))
      .filter((g) => g.count > 0)
  const gates: Record<string, Promise<void> | undefined> = {}
  const stub = installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': async (_r: Request, body: unknown) => {
      const { groupValue } = body as { groupValue?: string }
      // A column reads its rows when the request arrives (before a later commit), like the trace.
      if (groupValue) {
        const items = column(groupValue).map((x) => ({ group: groupValue, task: { ...x } }))
        await gates.column
        return json({ items })
      }
      await gates.lead
      return json({ items: [], groups: groups() })
    },
    'PATCH /api/v1/tasks/:id': async (r: Request, body: unknown) => {
      await gates.patch
      const id = new URL(r.url).pathname.split('/').pop()!
      const row = db.get(id)!
      Object.assign(row, body as object, { version: row.version + 1 })
      return json({ ...row })
    },
  } as never)
  return { stub, db, gates }
}

function deferred() {
  let open = () => {}
  const promise = new Promise<void>((resolve) => (open = resolve))
  return { promise, open }
}

/** The List's status pick, through the same write path (useTaskActions.patch). */
function StatusPick({ row }: { row: Row }) {
  const actions = useTaskActions()
  return (
    <button
      onClick={() => void actions.patch(row as unknown as TaskView, { statusId: 'st-doing' })}
    >
      Set in progress
    </button>
  )
}

const config = { v: 1, group: 'status', sort: [{ key: 'manual', dir: 'asc' }] }
const alpha = task(1, { title: 'Alpha' })
const beta = task(2, { title: 'Beta' })

const cardsIn = (name: string) =>
  [...screen.getByRole('region', { name }).querySelectorAll('li')].map((li) => li.textContent ?? '')

async function expectBetaInProgress() {
  await waitFor(() => {
    expect(cardsIn('In progress').some((c) => c.includes('Beta'))).toBe(true)
    expect(cardsIn('To do').some((c) => c.includes('Beta'))).toBe(false)
    expectColumnCountsMatchCards()
  })
}

describe('14yq6g334tg Board counts and cards after a status change', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))
  afterEach(() => useToastStore.setState({ toasts: [] }))

  it('AC1: a status change on a settled Board moves the card to its new column, counts match', async () => {
    server([alpha, beta])
    renderWithProviders(
      <>
        <StatusPick row={beta} />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(2))
    expectColumnCountsMatchCards()

    await userEvent.click(screen.getByRole('button', { name: 'Set in progress' }))

    await expectBetaInProgress()
  })

  it('AC2: the column queries read before the commit and settle before the save answers (the trace)', async () => {
    const { gates } = server([alpha, beta])
    const patch = deferred()
    const lead = deferred()
    gates.patch = patch.promise
    gates.lead = lead.promise
    renderWithProviders(
      <>
        <StatusPick row={beta} />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    // The save is sent; the Board's columns read the old rows and settle while it is in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Set in progress' }))
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(2))
    // The commit lands; the lead (counts) reads after it, then the save answers.
    patch.open()
    lead.open()

    await expectBetaInProgress()
  })

  it('AC3: column queries still in flight when the save answers are read again after it', async () => {
    const { gates, stub } = server([alpha, beta])
    const patch = deferred()
    const column = deferred()
    gates.patch = patch.promise
    gates.column = column.promise
    renderWithProviders(
      <>
        <StatusPick row={beta} />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Set in progress' }))
    await screen.findByRole('region', { name: 'In progress' })
    // The save answers while every column is still on its first load (read before the commit).
    patch.open()
    await waitFor(() => expect(stub.count('PATCH', /\/tasks\//)).toBe(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    gates.column = undefined
    column.open()

    await expectBetaInProgress()
  })

  const headerCount = (name: string) =>
    within(screen.getByRole('region', { name })).getByRole('heading').lastElementChild?.textContent

  it('AC4: a column with all its cards shows their number, even when the lead query counted otherwise', async () => {
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        if (groupValue === 'to do')
          return json({ items: [alpha, beta].map((x) => ({ group: 'to do', task: x })) })
        if (groupValue) return json({ items: [] })
        // A lead read at another moment: one more task in "to do", one in "in progress".
        return json({
          items: [],
          groups: [
            { key: 'to do', label: 'to do', count: 3 },
            { key: 'in progress', label: 'in progress', count: 1 },
          ],
        })
      },
    } as never)
    renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(2))
    await waitFor(() => expect(headerCount('To do')).toBe('2'))
    expect(headerCount('In progress')).toBe('0')
    expectColumnCountsMatchCards()
  })

  it('AC5: a column with more pages keeps the server count from the lead query', async () => {
    const many = Array.from({ length: 3 }, (_, i) => task(10 + i))
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        if (groupValue === 'to do')
          return json({ items: many.map((x) => ({ group: 'to do', task: x })), nextCursor: 'c2' })
        if (groupValue) return json({ items: [] })
        return json({ items: [], groups: [{ key: 'to do', label: 'to do', count: 120 }] })
      },
    } as never)
    renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await screen.findByRole('button', { name: 'Load more' })
    await waitFor(() => expect(headerCount('To do')).toBe('120'))
    expect(cardsIn('To do')).toHaveLength(3)
  })
})
