import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { InboxPage } from './InboxPage'
import { NotificationBell } from './NotificationBell'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'ASSIGNED',
  taskId: `t-${id}`,
  taskReadableId: `ACME-${id}`,
  taskTitle: `Task ${id}`,
  actorName: 'Maya',
  actorType: 'USER',
  read: false,
  createdAt: new Date().toISOString(),
  ...extra,
})

function serve(opts: { count?: number; items?: object[] } = {}) {
  let count = opts.count ?? 2
  let items = opts.items ?? [note('1'), note('2')]
  const stub = installFetch({
    'GET /api/v1/workspaces/:id/notifications/unread-count': () => json({ count }),
    'GET /api/v1/workspaces/:id/notifications': (request) => {
      const unread = new URL(request.url).searchParams.get('unread') === 'true'
      return json({ items: unread ? items.filter((i) => !(i as { read: boolean }).read) : items })
    },
    'POST /api/v1/notifications/:id/read': (request) => {
      const id = new URL(request.url).pathname.split('/')[4]
      items = items.map((i) => ((i as { id: string }).id === id ? { ...i, read: true } : i))
      count = Math.max(0, count - 1)
      return new Response(null, { status: 204 })
    },
    'POST /api/v1/workspaces/:id/notifications/read-all': () => {
      items = items.map((i) => ({ ...i, read: true }))
      count = 0
      return json({ marked: 2 })
    },
  })
  return stub
}

describe('CAP-11 bell and popover', () => {
  it('shows the unread count, "99+" above 99 and nothing at 0', async () => {
    serve({ count: 120 })
    const { unmount } = renderWithProviders(<NotificationBell workspaceId="w1" />)
    expect(await screen.findByRole('button', { name: 'Notifications, 99+ unread' })).toBeVisible()
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('99+')
    unmount()
    serve({ count: 0 })
    renderWithProviders(<NotificationBell workspaceId="w1" />)
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible()
    expect(screen.queryByTestId('unread-badge')).toBeNull()
  })

  it('opens a popover; a row opens the task and marks it read; Esc returns focus to the bell', async () => {
    const stub = serve()
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <Routes>
          <Route path="/" element={<NotificationBell workspaceId="w1" />} />
          <Route path="/t/:taskId" element={<p>task panel</p>} />
        </Routes>
        <Where />
      </>,
    )
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await user.click(bell)
    const dialog = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(await within(dialog).findByText('Maya assigned you to ACME-1 Task 1')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bell).toHaveFocus()

    await user.click(bell)
    await user.click(await screen.findByText('Maya assigned you to ACME-2 Task 2'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/t/t-2'))
    await waitFor(() => expect(stub.count('POST', /\/notifications\/2\/read$/)).toBe(1))
  })

  it('marks all read with the newest id as the boundary', async () => {
    const stub = serve()
    const user = userEvent.setup()
    renderWithProviders(<NotificationBell workspaceId="w1" />)
    await user.click(await screen.findByRole('button', { name: /Notifications/ }))
    await user.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(stub.count('POST', /read-all$/)).toBe(1))
    expect(stub.calls.find((c) => /read-all$/.test(c.url.pathname))!.body).toMatchObject({
      upToId: '1',
    })
  })
})

describe('CAP-11 inbox page', () => {
  function renderInbox() {
    return renderWithProviders(
      <Routes>
        <Route path="/w/:workspaceId/inbox" element={<InboxPage />} />
      </Routes>,
      { route: '/w/w1/inbox' },
    )
  }

  it('has Unread and All tabs and says "You\'re all caught up." with nothing unread', async () => {
    serve({ count: 0, items: [note('1', { read: true })] })
    const user = userEvent.setup()
    renderInbox()
    expect(await screen.findByText("You're all caught up.")).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(await screen.findByText('Maya assigned you to ACME-1 Task 1')).toBeVisible()
  })

  it('marks a row read from its menu button', async () => {
    const stub = serve()
    const user = userEvent.setup()
    renderInbox()
    const row = (await screen.findByText('Maya assigned you to ACME-1 Task 1')).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Mark read' }))
    await waitFor(() => expect(stub.count('POST', /\/notifications\/1\/read$/)).toBe(1))
  })
})
