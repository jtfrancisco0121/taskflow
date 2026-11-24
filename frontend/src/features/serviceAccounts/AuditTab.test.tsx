import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AuditTab } from './AuditTab'

const BASE = '/api/v1/workspaces/:id/service-accounts/:id'
const TASK = '3f2b8f0e-aaaa-4bbb-8ccc-1234567890ab'
const LOC = '3f2b8f0e-bbbb-4bbb-8ccc-1234567890ab'

const day = (n: number, calls: number) => ({
  day: `2026-10-${String(n).padStart(2, '0')}`,
  calls,
})
const days = Array.from({ length: 30 }, (_, i) => day(i + 1, i === 29 ? 7 : 0))

const change = (id: string, type: string, entity: string, entityId: string, payload = {}) => ({
  id,
  type,
  entity,
  entityId,
  payload,
  actorKeyName: 'CI-1',
  createdAt: new Date().toISOString(),
})

function renderAudit() {
  return renderWithProviders(<AuditTab workspaceId="w1" accountId="sa1" />)
}

describe('AuditTab', () => {
  it('KEY-6: shows 30 day rows, the last use per key and the empty copy for no changes', async () => {
    installFetch({
      [`GET ${BASE}/audit`]: {
        totalCalls: 7,
        days,
        keys: [{ id: 'k1', name: 'CI-1', calls: 7, lastUsedAt: new Date().toISOString() }],
      },
      [`GET ${BASE}/activity`]: { items: [] },
    })
    renderAudit()
    const table = await screen.findByRole('table', { name: 'Calls per day' })
    expect(within(table).getAllByRole('row')).toHaveLength(30)
    expect(screen.getByText(/last used just now, 7 calls/)).toBeVisible()
    expect(await screen.findByText('No changes yet.')).toBeVisible()
  })

  it('KEY-6: with no calls it says so', async () => {
    installFetch({
      [`GET ${BASE}/audit`]: {
        totalCalls: 0,
        days: days.map((d) => ({ ...d, calls: 0 })),
        keys: [],
      },
      [`GET ${BASE}/activity`]: { items: [] },
    })
    renderAudit()
    expect(await screen.findByText('No calls in the last 30 days.')).toBeVisible()
  })

  it('FR-9: a location change is text, a task change links, and Load more follows the cursor', async () => {
    const user = userEvent.setup()
    installFetch({
      [`GET ${BASE}/audit`]: { totalCalls: 0, days, keys: [] },
      [`GET ${BASE}/activity`]: (request) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        return cursor
          ? json({ items: [change('c3', 'task.created', 'task', 'older-task')] })
          : json({
              items: [
                change('c1', 'location.renamed', 'location', LOC),
                change('c2', 'task.updated', 'task', TASK),
              ],
              nextCursor: 'next',
            })
      },
    })
    renderAudit()
    expect(await screen.findByText('renamed a location')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'renamed a location' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'updated a task' })).toHaveAttribute(
      'href',
      `/t/${TASK}`,
    )
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('link', { name: 'created a task' })).toHaveAttribute(
      'href',
      '/t/older-task',
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('UJ-4: a trashed task offers Restore with the payload version in If-Match', async () => {
    const user = userEvent.setup()
    useToastStore.setState({ toasts: [] })
    const stub = installFetch({
      [`GET ${BASE}/audit`]: { totalCalls: 0, days, keys: [] },
      [`GET ${BASE}/activity`]: {
        items: [change('c1', 'task.trashed', 'task', TASK, { version: 4, listId: 'l1' })],
      },
      'POST /api/v1/tasks/:id/restore': json({ id: TASK }),
    })
    renderAudit()
    expect(await screen.findByText('moved a task to the trash')).toBeVisible()
    expect(screen.queryByRole('link', { name: /trash/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Task restored'),
    )
    const call = stub.calls.find((c) => c.method === 'POST')!
    expect(call.url.pathname).toBe(`/api/v1/tasks/${TASK}/restore`)
    expect(call.headers.get('If-Match')).toBe('"4"')
    // the activity list is fetched again
    await waitFor(() => expect(stub.count('GET', /activity$/)).toBeGreaterThan(1))
  })

  it('UJ-4: a stale restore (409) or a purged task (404) explains itself in a toast', async () => {
    const user = userEvent.setup()
    for (const status of [409, 404]) {
      useToastStore.setState({ toasts: [] })
      installFetch({
        [`GET ${BASE}/audit`]: { totalCalls: 0, days, keys: [] },
        [`GET ${BASE}/activity`]: {
          items: [change('c1', 'task.trashed', 'task', TASK, { version: 4 })],
        },
        'POST /api/v1/tasks/:id/restore': problem(status, 'task.x', 'nope'),
      })
      const { unmount } = renderAudit()
      await user.click(await screen.findByRole('button', { name: 'Restore' }))
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
          'This task was already restored, changed or purged.',
        ),
      )
      unmount()
    }
  })
})
