import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { pick } from '../../test/ui'
import { quickDays } from './quickDays'
import { ListRenderer } from './ListRenderer'
import { baseRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'

type Patch = Record<string, unknown>

function serve(
  rows: ReturnType<typeof task>[],
  patch?: (r: Request, body: unknown) => Response | Promise<Response>,
) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () => json({ items: rows.map((t) => ({ task: t })) }),
    'PATCH /api/v1/tasks/:id':
      patch ??
      ((_r: Request, body: unknown) => json({ ...rows[0], ...(body as Patch), version: 2 })),
  } as never)
}

const patches = (stub: ReturnType<typeof installFetch>) =>
  stub.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)

describe('List popover editors (CAP-2)', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [], openEditor: null, focusedTaskId: null })
    useToastStore.setState({ toasts: [] })
  })

  it('the status editor lists the statuses, saves the pick and gives focus back to its trigger', async () => {
    const stub = serve([task(1)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    const trigger = await screen.findByLabelText('Status of ACME-1')
    await pick(user, trigger, 'In progress')
    await waitFor(() => expect(patches(stub)).toEqual([{ statusId: 'st-doing' }]))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a keyboard pick works too: search, arrow, Enter', async () => {
    const stub = serve([task(1)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    await user.click(await screen.findByLabelText('Priority of ACME-1'))
    await user.keyboard('urg{Enter}')
    await waitFor(() => expect(patches(stub)).toEqual([{ priority: 'URGENT' }]))
  })

  it('an open editor set by the store (a key) shows its popover', async () => {
    serve([task(1)])
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    await screen.findByLabelText('Status of ACME-1')
    useViewStore.getState().setOpenEditor({ taskId: 't1', field: 'status' })
    expect(await screen.findByRole('option', { name: 'Done' })).toBeVisible()
  })

  it('the due editor offers Today, Tomorrow, Next week and No date and sends UTC midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-26T15:00:00Z') })
    try {
      const stub = serve([task(1, { dueDate: '2026-11-20T00:00:00Z' })])
      const user = userEvent.setup()
      renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
      const trigger = await screen.findByLabelText('Due date of ACME-1')
      await pick(user, trigger, 'Tomorrow')
      await waitFor(() => expect(patches(stub)).toEqual([{ dueDate: '2026-11-27T00:00:00Z' }]))
      await pick(user, trigger, 'Next week')
      await waitFor(() => expect(patches(stub).at(-1)).toEqual({ dueDate: '2026-11-30T00:00:00Z' }))
      await pick(user, trigger, 'No date')
      await waitFor(() => expect(patches(stub).at(-1)).toEqual({ dueDate: null }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('computes the quick days in UTC', () => {
    expect(quickDays(new Date('2026-11-26T23:30:00Z'))).toEqual({
      today: '2026-11-26',
      tomorrow: '2026-11-27',
      nextWeek: '2026-11-30',
    })
    // Monday: next week is seven days later; Sunday: the next day.
    expect(quickDays(new Date('2026-11-30T00:00:00Z')).nextWeek).toBe('2026-12-07')
    expect(quickDays(new Date('2026-11-29T10:00:00Z')).nextWeek).toBe('2026-11-30')
  })

  it('the due editor has a day field that sends the picked day', async () => {
    const stub = serve([task(1)])
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    await user.click(await screen.findByLabelText('Due date of ACME-1'))
    await user.type(await screen.findByLabelText('Due day of ACME-1'), '2026-12-24')
    await waitFor(() => expect(patches(stub)).toEqual([{ dueDate: '2026-12-24T00:00:00Z' }]))
  })

  it('three quick assignee toggles with the first patch still pending all persist, in order', async () => {
    const rows = [task(1)]
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let first = true
    const stub = serve(rows, async (_r, body) => {
      if (first) {
        first = false
        await gate
      }
      Object.assign(rows[0], body, { version: rows[0].version + 1 })
      return json(rows[0])
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    const trigger = await screen.findByLabelText('Assignees of ACME-1')
    await pick(user, trigger, 'Maya Lopez')
    await pick(user, trigger, 'Omar Haddad')
    await pick(user, trigger, 'Maya Lopez')
    release()
    await waitFor(() => expect(patches(stub)).toHaveLength(3))
    expect(patches(stub)).toEqual([
      { assigneeIds: ['u1'] },
      { assigneeIds: ['u1', 'u2'] },
      { assigneeIds: ['u2'] },
    ])
  })

  it('a 409 reverts the trigger and toasts', async () => {
    const rows = [task(1)]
    serve(rows, () => {
      rows[0] = task(1, { priority: 'LOW', version: 9 })
      return problem(409, 'task.version_conflict', 'changed', { current: rows[0] })
    })
    const user = userEvent.setup()
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />)
    await pick(user, await screen.findByLabelText('Priority of ACME-1'), 'Urgent')
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'This task changed. Review and try again.',
      ),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Priority of ACME-1')).toHaveTextContent('Low'),
    )
  })
})
