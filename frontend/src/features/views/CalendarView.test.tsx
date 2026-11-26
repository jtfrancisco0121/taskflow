import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { addDays, calendarRange, dueDateFor, shiftAnchor, weekStart } from './calendarGrid'
import { CalendarRenderer } from './CalendarRenderer'
import { baseRoutes, scope, task } from './testSupport'

describe('CAL-1 calendar grid', () => {
  it('weeks start on Monday and a month shows whole weeks of UTC days', () => {
    expect(weekStart('2026-11-25')).toBe('2026-11-23')
    expect(weekStart('2026-11-29')).toBe('2026-11-23')
    const month = calendarRange('month', '2026-11-25')
    expect(month.days[0]).toBe('2026-10-26')
    expect(month.days.at(-1)).toBe('2026-12-06')
    expect(month.days).toHaveLength(42)
    const week = calendarRange('week', '2026-11-25')
    expect(week.days).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ])
  })

  it('previous and next move by a month or a week; a drop sends that day at 00:00 UTC', () => {
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01')
    expect(shiftAnchor('week', '2026-11-25', 1)).toBe('2026-12-02')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(dueDateFor('2026-11-26')).toBe('2026-11-26T00:00:00Z')
  })
})

function layOut() {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLElement && this.dataset.day) {
      const i = [...(this.parentElement?.children ?? [])]
        .filter((c) => (c as HTMLElement).dataset.day)
        .indexOf(this)
      return new DOMRect((i % 7) * 100, 40 + Math.floor(i / 7) * 100, 90, 90)
    }
    if (this instanceof HTMLElement && this.tagName === 'LI') {
      const cell = this.closest('[data-day]')!.getBoundingClientRect()
      return new DOMRect(cell.left + 4, cell.top + 20, 80, 20)
    }
    return new DOMRect(0, 0, 1000, 600)
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

const dated = (n: number, day: string, extra = {}) =>
  task(n, { dueDate: `${day}T00:00:00Z`, ...extra })

function serve(
  tasks: ReturnType<typeof task>[],
  patch: (request: Request, body: unknown) => Response | Promise<Response>,
) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': (_r: Request, body: unknown) => {
      const config = (body as { config: { group?: string } }).config
      if (config.group === 'dueDate') {
        return json({ items: [], groups: [{ key: 'none', label: 'No date', count: 2 }] })
      }
      return json({ items: tasks.map((t) => ({ task: t })) })
    },
    'PATCH /api/v1/tasks/:id': patch,
  } as never)
}

describe('CAL-1 Calendar view', () => {
  let restore = () => {}
  beforeEach(() => {
    restore = layOut()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => restore())

  const week = { v: 1, mode: 'week' }
  const route = '/w/w1/l/l1/v/cal?m=week&d=2026-11-25'

  it('CAL-1: a task sits on its UTC day, the range is a dueDate condition and undated tasks are counted', async () => {
    const stub = serve([dated(1, '2026-11-25'), dated(2, '2026-11-23')], () => json({}))
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })

    const wed = await screen.findByRole('gridcell', { name: '2026-11-25' })
    expect(await within(wed).findByRole('link', { name: 'Task 1' })).toBeVisible()
    expect(
      within(screen.getByRole('gridcell', { name: '2026-11-23' })).getByRole('link', {
        name: 'Task 2',
      }),
    ).toBeVisible()
    expect(await screen.findByText(/2 tasks have no due date/)).toBeVisible()
    const query = stub.calls.find(
      (c) =>
        c.url.pathname === '/api/v1/views/query' && (c.body as { limit: number }).limit === 200,
    )!
    expect(JSON.stringify((query.body as { config: unknown }).config)).toContain(
      '"field":"dueDate","op":"between","value":["2026-11-23","2026-11-29"]',
    )
  })

  it('CAL-1: the mode and the day go to the URL through update', async () => {
    serve([], () => json({}))
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={update} />, { route })
    await user.click(await screen.findByRole('button', { name: 'Month' }))
    expect(update).toHaveBeenLastCalledWith({ m: 'month', d: '2026-11-25' })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(update).toHaveBeenLastCalledWith({ d: '2026-12-02' })
  })

  async function keyboardDrop(title: string) {
    const user = userEvent.setup()
    const chip = (await screen.findByRole('link', { name: title })).closest('li')!
    chip.focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    await user.keyboard(' ')
  }

  it('CAL-1: a keyboard drop sends the next day at UTC midnight with If-Match', async () => {
    const stub = serve([dated(1, '2026-11-25')], (_r, body) =>
      json({ ...dated(1, '2026-11-26'), ...(body as object), version: 2 }),
    )
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    await keyboardDrop('Task 1')

    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = stub.calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ dueDate: '2026-11-26T00:00:00Z' })
    expect(patch.headers.get('If-Match')).toBe('"1"')
    await waitFor(() =>
      expect(
        within(screen.getByRole('gridcell', { name: '2026-11-26' })).getByRole('link', {
          name: 'Task 1',
        }),
      ).toBeVisible(),
    )
  })

  it('CAL-1: a 409 and a validation error send the task back to its day with a notice', async () => {
    serve([dated(1, '2026-11-25')], () =>
      problem(409, 'task.version_conflict', 'changed', {
        current: dated(1, '2026-11-25', { version: 4 }),
      }),
    )
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    await keyboardDrop('Task 1')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    expect(
      within(screen.getByRole('gridcell', { name: '2026-11-25' })).getByRole('link', {
        name: 'Task 1',
      }),
    ).toBeVisible()
  })

  it('CAL-1: a due date before the start date is rolled back with the server message', async () => {
    serve([dated(1, '2026-11-25')], () =>
      problem(400, 'task.invalid_dates', 'The start date must not be after the due date'),
    )
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    await keyboardDrop('Task 1')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'The start date must not be after the due date',
      ),
    )
    expect(
      within(screen.getByRole('gridcell', { name: '2026-11-25' })).getByRole('link', {
        name: 'Task 1',
      }),
    ).toBeVisible()
  })

  it('CAL-1: a chip shows its status colour and name, its priority and the Blocked badge', async () => {
    serve(
      [
        dated(1, '2026-11-25', {
          statusId: 'st-doing',
          priority: 'URGENT',
          blocked: true,
          blockerCount: 2,
        }),
      ],
      () => json({}),
    )
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    const chip = (await screen.findByRole('link', { name: 'Task 1' })).closest('li')!
    const dot = await within(chip).findByRole('img', { name: 'In progress' })
    expect(dot).toHaveStyle({ backgroundColor: '#3b82f6' })
    expect(within(chip).getByText('Urgent')).toBeVisible()
    expect(within(chip).getByRole('img', { name: 'Blocked by 2 tasks' })).toBeVisible()
  })

  it('CAL-1: Previous and Next are icon buttons, the month title names the anchor, Today goes to today', async () => {
    serve([], () => json({}))
    const update = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={update} />, { route })
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(update).toHaveBeenLastCalledWith({ d: '2026-11-18' })
    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(update.mock.lastCall![0].d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('CAL-1: more than three tasks on a day collapse into a "+N more" toggle', async () => {
    serve(
      [1, 2, 3, 4, 5].map((n) => dated(n, '2026-11-25')),
      () => json({}),
    )
    const user = userEvent.setup()
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    const wed = await screen.findByRole('gridcell', { name: '2026-11-25' })
    await within(wed).findByRole('link', { name: 'Task 1' })
    expect(within(wed).queryByRole('link', { name: 'Task 4' })).toBeNull()
    await user.click(within(wed).getByRole('button', { name: '+2 more' }))
    expect(within(wed).getByRole('link', { name: 'Task 5' })).toBeVisible()
    await user.click(within(wed).getByRole('button', { name: 'Show less' }))
    expect(within(wed).queryByRole('link', { name: 'Task 5' })).toBeNull()
  })

  it('CAL-1: loading shows a status with skeletons; the toolbar is already there', async () => {
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () => new Promise<Response>(() => {}),
    } as never)
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    expect(await screen.findByRole('status', { name: 'Loading the Calendar' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Today' })).toBeVisible()
  })

  it('CAL-1: a failed load shows the ErrorState and Retry reloads', async () => {
    let calls = 0
    installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () => {
        calls += 1
        return calls <= 2
          ? problem(500, 'server.error', 'Boom')
          : json({ items: [{ task: dated(1, '2026-11-25') }] })
      },
    } as never)
    const user = userEvent.setup()
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()
  })

  it('CAL-1: an empty range says so and still shows the grid', async () => {
    serve([], () => json({}))
    renderWithProviders(<CalendarRenderer scope={scope} config={week} update={vi.fn()} />, {
      route,
    })
    expect(await screen.findByText('No tasks due in this range.')).toBeVisible()
    expect(screen.getByRole('grid', { name: 'Calendar' })).toBeVisible()
  })

  it('CAL-1: keyboard Down moves a task one week and Left one day back', async () => {
    const stub = serve([dated(1, '2026-11-25')], (_r, body) =>
      json({ ...dated(1, '2026-12-02'), ...(body as object), version: 2 }),
    )
    const month = { v: 1, mode: 'month' }
    renderWithProviders(<CalendarRenderer scope={scope} config={month} update={vi.fn()} />, {
      route: '/w/w1/l/l1/v/cal?m=month&d=2026-11-25',
    })
    const user = userEvent.setup()
    const chip = (await screen.findByRole('link', { name: 'Task 1' })).closest('li')!
    chip.focus()
    await user.keyboard(' ')
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')
    await waitFor(() => expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(stub.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      dueDate: '2026-12-02T00:00:00Z',
    })
  })
})
