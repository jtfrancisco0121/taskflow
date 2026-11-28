import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { queryKeys } from '../../api/queryKeys'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { runLimited } from './bulk'
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

/** A non-regrouping save (a title) through the same write path. */
function TitlePick({ row, title }: { row: Row; title: string }) {
  const actions = useTaskActions()
  return (
    <button onClick={() => void actions.patch(row as unknown as TaskView, { title })}>
      Rename {row.title}
    </button>
  )
}

/** Bulk fan-out like BulkBar: silent per-task saves, at most 6 in flight. */
function BulkStatus({ rows }: { rows: Row[] }) {
  const actions = useTaskActions()
  return (
    <button
      onClick={() =>
        void runLimited(
          rows,
          (r) => actions.patch(r as unknown as TaskView, { statusId: 'st-doing' }, true),
          6,
        )
      }
    >
      Bulk in progress
    </button>
  )
}

const settle = (ms = 300) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const viewReads = (stub: { count: (m: string, p: RegExp) => number }) =>
  stub.count('POST', /\/views\/query$/)

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
  it('AC6 (M1): a regroup refetch in flight does not overwrite a later save of another task', async () => {
    const { gates, stub } = server([alpha, beta])
    renderWithProviders(
      <>
        <StatusPick row={beta} />
        <TitlePick row={alpha} title="Alpha renamed" />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(2))
    const before = viewReads(stub)
    // X: the regrouping save; its column refetches read now (Alpha's old title) and are held.
    const column = deferred()
    gates.column = column.promise
    await userEvent.click(screen.getByRole('button', { name: 'Set in progress' }))
    await waitFor(() => expect(viewReads(stub)).toBeGreaterThan(before + 1))
    // Y: a non-regrouping save commits while X's column reads are in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Rename Alpha' }))
    await waitFor(() => expect(stub.count('PATCH', /\/tasks\//)).toBe(2))
    await settle(20)
    // X's responses, read before Y's commit, are released last.
    gates.column = undefined
    column.open()
    await settle()

    await waitFor(() => {
      expect(cardsIn('To do').some((c) => c.includes('Alpha renamed'))).toBe(true)
      expect(cardsIn('To do').some((c) => c.includes('Alpha') && !c.includes('renamed'))).toBe(
        false,
      )
    })
    await expectBetaInProgress()
  })

  it('AC7 (M2): five regrouping saves at once read the Board at most twice (2 x (N+1) view queries)', async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => task(n, { title: `Bulk ${n}` }))
    const { stub } = server(rows)
    renderWithProviders(
      <>
        <BulkStatus rows={rows} />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(5))
    await settle(150)
    const before = viewReads(stub)
    // N + 1 view queries per read of the Board: the lead and one per column (to do, in progress after the moves).
    const perRead = 3

    await userEvent.click(screen.getByRole('button', { name: 'Bulk in progress' }))
    await waitFor(() => expect(stub.count('PATCH', /\/tasks\//)).toBe(5))
    await settle()

    await waitFor(() => expect(cardsIn('In progress')).toHaveLength(5))
    expectColumnCountsMatchCards()
    expect(viewReads(stub) - before).toBeGreaterThan(0)
    expect(viewReads(stub) - before).toBeLessThanOrEqual(2 * perRead)
  })

  it('AC8 (minor): a column whose refetch fails shows the number of its cards, not the lead count', async () => {
    let failColumns = false
    let leadToDo = 2
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': (_r: Request, body: unknown) => {
        const { groupValue } = body as { groupValue?: string }
        if (groupValue && failColumns) return problem(500, 'server.error', 'Boom')
        if (groupValue === 'to do')
          return json({ items: [alpha, beta].map((x) => ({ group: 'to do', task: x })) })
        if (groupValue) return json({ items: [] })
        return json({ items: [], groups: [{ key: 'to do', label: 'to do', count: leadToDo }] })
      },
    } as never)
    const { queryClient } = renderWithProviders(<BoardRenderer scope={scope} config={config} />)
    await waitFor(() => expect(cardsIn('To do')).toHaveLength(2))
    await waitFor(() => expect(headerCount('To do')).toBe('2'))
    // The lead now counts 3; the column's refetch fails and keeps its two cards.
    failColumns = true
    leadToDo = 3
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.viewsAll('w1') }))
    await settle(50)

    expect(cardsIn('To do')).toHaveLength(2)
    expect(headerCount('To do')).toBe('2')
    expectColumnCountsMatchCards()
  })

  it('AC9 (minor): a regroup refresh keeps a Load more in flight; its page is shown', async () => {
    const first = [1, 2].map((n) => task(n, { title: `First ${n}` }))
    const more = task(3, { title: 'Page two' })
    const loadMore = deferred()
    const rowsInToDo = [...first, more]
    const other = task(9, { title: 'Elsewhere', statusId: 'st-done' })
    const stub = installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': async (_r: Request, body: unknown) => {
        const { groupValue, cursor } = body as { groupValue?: string; cursor?: string }
        if (groupValue === 'to do') {
          const page = cursor ? rowsInToDo.slice(2) : rowsInToDo.slice(0, 2)
          const items = page.map((x) => ({ group: 'to do', task: x }))
          if (cursor) {
            await loadMore.promise
            return json({ items })
          }
          return json({ items, nextCursor: rowsInToDo.length > 2 ? 'c2' : undefined })
        }
        if (groupValue) return json({ items: [] })
        return json({ items: [], groups: [{ key: 'to do', label: 'to do', count: 3 }] })
      },
      'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) =>
        json({ ...other, ...(body as object), version: 2 }),
    } as never)
    renderWithProviders(
      <>
        <StatusPick row={other} />
        <BoardRenderer scope={scope} config={config} />
      </>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(stub.calls.some((c) => (c.body as { cursor?: string })?.cursor)).toBe(true),
    )
    // A regrouping save elsewhere refreshes the views while the Load more is in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Set in progress' }))
    await waitFor(() => expect(stub.count('PATCH', /\/tasks\//)).toBe(1))
    await settle(150)
    loadMore.open()

    await waitFor(() => expect(cardsIn('To do').some((c) => c.includes('Page two'))).toBe(true))
    expect(cardsIn('To do')).toHaveLength(3)
  })
})
