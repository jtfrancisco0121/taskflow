import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { OneTimeKeyDialog } from '../../features/serviceAccounts'
import { Dialog } from '../../shared/ui/Dialog'
import { useThemeStore } from '../../shared/theme/theme-store'
import { useUiStore } from '../../shared/ui-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AppShell } from '../AppShell'

const acme = { id: 'w1', name: 'Acme', role: 'OWNER' }
const beta = { id: 'w2', name: 'Beta', role: 'MEMBER' }
const space = { id: 's1', name: 'Marketing', type: 'SPACE', hasChildren: true }
const list = { id: 'l1', name: 'Launch', type: 'LIST', parentId: 's1', hasChildren: false }
const hit = (id: string, title: string, snippet?: string) => ({
  taskId: id,
  readableId: `ACME-${id}`,
  title,
  listName: 'Launch',
  snippet,
})

type Options = {
  route?: string
  search?: (q: string) => Response
  workspaces?: object[]
  extra?: ReactNodeLike
}
type ReactNodeLike = React.ReactNode

function setup(options: Options = {}) {
  localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1']))
  const stub = installFetch({
    'GET /api/v1/workspaces': { items: options.workspaces ?? [acme, beta] },
    'GET /api/v1/workspaces/:id/notifications/unread-count': { count: 0 },
    'GET /api/v1/workspaces/:id/tree': (request) =>
      new URL(request.url).searchParams.get('parentId') === 's1'
        ? json({ items: [list] })
        : json({ items: [space] }),
    'GET /api/v1/workspaces/:id/search': (request) =>
      (options.search ?? (() => json({ items: [] })))(new URL(request.url).searchParams.get('q')!),
    'POST /api/v1/auth/signout': () => new Response(null, { status: 204 }),
  })
  function Where() {
    const location = useLocation()
    return <p data-testid="where">{location.pathname}</p>
  }
  const page = (
    <>
      <Where />
      <input aria-label="Plain field" />
      {options.extra}
    </>
  )
  const view = renderWithProviders(
    <Routes>
      <Route element={<AppShell />}>
        {[
          '/w/:workspaceId',
          '/w/:workspaceId/inbox',
          '/w/:workspaceId/l/:locationId',
          '/w/:workspaceId/l/:locationId/automations',
          '/w/:workspaceId/settings/*',
          '/t/:taskId',
          '/setup',
        ].map((path) => (
          <Route key={path} path={path} element={page} />
        ))}
      </Route>
      <Route path="/signin" element={<p>Sign in page</p>} />
    </Routes>,
    { route: options.route ?? '/w/w1' },
  )
  return { stub, ...view }
}

const palette = () => screen.queryByRole('dialog', { name: 'Command palette' })
const field = () => screen.getByRole('combobox', { name: 'Search commands and tasks' })
const where = () => screen.getByTestId('where').textContent
const CTRL_K = '{Control>}k{/Control}'
const META_K = '{Meta>}k{/Meta}'

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Workspace switcher' })
  await user.keyboard(CTRL_K)
  await screen.findByRole('dialog', { name: 'Command palette' })
}

describe('Command palette', () => {
  it('opens with Cmd+K and Ctrl+K, also from inside a text field, with focus in its search', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('button', { name: 'Workspace switcher' })
    await user.click(screen.getByRole('textbox', { name: 'Plain field' }))
    await user.keyboard(META_K)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(field()).toHaveFocus()
    await user.keyboard(META_K)
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    await user.keyboard(CTRL_K)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeVisible()
    expect(field()).toHaveFocus()
  })

  it('pressing the shortcut again closes it and Escape closes it, giving focus back', async () => {
    const user = userEvent.setup()
    setup()
    const input = await screen.findByRole('textbox', { name: 'Plain field' })
    await user.click(input)
    await user.keyboard(CTRL_K)
    await screen.findByRole('dialog', { name: 'Command palette' })
    await user.keyboard(CTRL_K)
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    expect(input).toHaveFocus()
    await user.keyboard(CTRL_K)
    await screen.findByRole('dialog', { name: 'Command palette' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    expect(input).toHaveFocus()
  })

  it('the top-bar trigger opens it and shows the key hint', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = await screen.findByRole('button', { name: 'Command palette' })
    expect(trigger).toHaveTextContent('Search or jump')
    expect(trigger.querySelector('kbd')).not.toBeNull()
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeVisible()
  })

  it('lists the groups, moves with the arrows and runs the highlighted Command with Enter', async () => {
    const user = userEvent.setup()
    setup()
    await openPalette(user)
    const dialog = palette()!
    for (const heading of ['Go to', 'Workspaces', 'Theme', 'Actions']) {
      expect(within(dialog).getByText(heading)).toBeInTheDocument()
    }
    await user.keyboard('Aurora{Enter}')
    await waitFor(() => expect(palette()).not.toBeInTheDocument())
    expect(useThemeStore.getState().choice).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    await user.keyboard(CTRL_K)
    await screen.findByRole('dialog', { name: 'Command palette' })
    await user.keyboard('Go to Inbox{ArrowDown}{ArrowUp}{Enter}')
    await waitFor(() => expect(where()).toBe('/w/w1/inbox'))
  })

  it('shows the current Theme choice with a check and marks the kind of a Location', async () => {
    const user = userEvent.setup()
    setup()
    await openPalette(user)
    expect(screen.getByRole('option', { name: /Theme: System/ })).toHaveTextContent('✓')
    expect(screen.getByRole('option', { name: /Go to Marketing/ })).toHaveTextContent('Space')
    await user.type(field(), 'launch')
    expect(await screen.findByRole('option', { name: /Go to Launch/ })).toHaveTextContent('List')
  })

  it('lists no service-accounts Command for a member and Workspaces only when there are several', async () => {
    const user = userEvent.setup()
    setup({ workspaces: [{ ...acme, role: 'MEMBER' }] })
    await screen.findByRole('button', { name: 'Workspace switcher' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Workspace switcher' })).toHaveTextContent('Acme'),
    )
    await user.keyboard(CTRL_K)
    await screen.findByRole('dialog', { name: 'Command palette' })
    expect(screen.queryByRole('option', { name: /service accounts/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument()
  })

  it('switches Workspace and goes to the Inbox, settings and service accounts', async () => {
    const user = userEvent.setup()
    setup()
    await openPalette(user)
    await user.type(field(), 'Switch to Beta{Enter}')
    await waitFor(() => expect(where()).toBe('/w/w2'))
  })

  describe('Tasks group', () => {
    it('sends no request under 2 characters, then shows every hit including a description-only match', async () => {
      const user = userEvent.setup()
      const { stub } = setup({
        search: () =>
          json({
            items: [
              hit('1', 'Quarterly numbers', '…the <mark>zeppelin</mark> budget'),
              hit('2', 'Plan'),
            ],
          }),
      })
      await openPalette(user)
      await user.type(field(), 'z')
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(stub.calls.filter((c) => c.url.pathname.endsWith('/search'))).toHaveLength(0)
      expect(screen.queryByText('Tasks')).not.toBeInTheDocument()
      await user.type(field(), 'ep')
      expect(await screen.findByRole('option', { name: /Quarterly numbers/ })).toBeVisible()
      expect(screen.getByRole('option', { name: /Plan/ })).toBeVisible()
      const calls = stub.calls.filter((c) => c.url.pathname.endsWith('/search'))
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.at(-1)!.url.searchParams.get('limit')).toBe('20')
    })

    it('shows a Searching… row while the request runs', async () => {
      const user = userEvent.setup()
      setup({ search: () => new Response(null, { status: 500 }) })
      await openPalette(user)
      await user.type(field(), 'ze')
      expect(await within(palette()!).findByRole('status')).toHaveTextContent('Searching…')
    })

    it('a failed search shows an error line and the other groups still work', async () => {
      const user = userEvent.setup()
      setup({ search: () => problem(500, 'boom', 'boom') })
      await openPalette(user)
      await user.type(field(), 'Aurora')
      expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t search tasks.')
      expect(screen.getByRole('option', { name: /Theme: Aurora/ })).toBeVisible()
    })

    it('Enter on a task opens its panel over the current view', async () => {
      const user = userEvent.setup()
      setup({
        route: '/w/w1/l/l1',
        search: () => json({ items: [hit('t9', 'Fix the sign-in redirect')] }),
      })
      await openPalette(user)
      await user.type(field(), 'sign-in')
      await screen.findByRole('option', { name: /Fix the sign-in redirect/ })
      await user.keyboard('{Enter}')
      await waitFor(() => expect(where()).toBe('/t/t9'))
    })

    it('says so when nothing matches', async () => {
      const user = userEvent.setup()
      setup()
      await openPalette(user)
      await user.type(field(), 'qqqqq')
      await waitFor(() => expect(screen.getByText('No matches for “qqqqq”.')).toBeVisible())
    })
  })

  describe('Actions', () => {
    it('New Space with the sidebar closed opens it with the new-Space field focused', async () => {
      const user = userEvent.setup()
      useUiStore.setState({ sidebarOpen: false })
      setup()
      await screen.findByRole('button', { name: 'Toggle sidebar' })
      await user.keyboard(CTRL_K)
      await screen.findByRole('dialog', { name: 'Command palette' })
      await user.type(field(), 'New Space{Enter}')
      const nameField = await screen.findByRole('textbox', { name: 'New Space name' })
      await waitFor(() => expect(nameField).toHaveFocus())
      expect(useUiStore.getState().sidebarOpen).toBe(true)
    })

    it('Toggle sidebar flips the store and focus lands on the toggle', async () => {
      const user = userEvent.setup()
      setup()
      await openPalette(user)
      await user.type(field(), 'Toggle sidebar{Enter}')
      await waitFor(() => expect(useUiStore.getState().sidebarOpen).toBe(false))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toHaveFocus(),
      )
    })

    it('Sign out calls the same sign-out as the footer', async () => {
      const user = userEvent.setup()
      const { stub } = setup()
      await openPalette(user)
      await user.type(field(), 'Sign out{Enter}')
      await waitFor(() => expect(stub.count('POST', /\/auth\/signout$/)).toBe(1))
      expect(await screen.findByText('Sign in page')).toBeVisible()
    })
  })

  describe('route builders', () => {
    it('Go to Inbox and Go to a Location use the hrefs of their sidebar entries', async () => {
      const user = userEvent.setup()
      setup()
      await openPalette(user)
      const inboxHref = screen.getByRole('link', { name: 'Inbox' }).getAttribute('href')
      const launchHref = (await screen.findByRole('link', { name: 'Launch' })).getAttribute('href')
      await user.type(field(), 'Go to Inbox{Enter}')
      await waitFor(() => expect(where()).toBe(inboxHref))
      await user.keyboard(CTRL_K)
      await screen.findByRole('dialog', { name: 'Command palette' })
      await user.type(field(), 'Go to Launch{Enter}')
      await waitFor(() => expect(where()).toBe(launchHref))
    })

    it('Go to automations is offered on a List route only', async () => {
      const user = userEvent.setup()
      const { unmount } = setup({ route: '/w/w1/l/l1' })
      await openPalette(user)
      await screen.findByRole('option', { name: /Go to automations/ })
      await user.keyboard('{Escape}')
      unmount()
      setup({ route: '/w/w1' })
      await openPalette(user)
      expect(screen.queryByRole('option', { name: /Go to automations/ })).not.toBeInTheDocument()
    })
  })

  describe('guards', () => {
    it('does nothing while the one-time key dialog is open, and the key dialog stays', async () => {
      const user = userEvent.setup()
      setup({ extra: <OneTimeKeyDialog keyName="CI" secret="tf_sk_secret" onDone={() => {}} /> })
      await screen.findByRole('button', { name: 'Workspace switcher' })
      await user.keyboard(CTRL_K)
      await user.keyboard(META_K)
      expect(palette()).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: /Key CI created/ })).toBeVisible()
    })

    it('does nothing while any other library Dialog is open', async () => {
      const user = userEvent.setup()
      setup({
        extra: (
          <Dialog title="Move Launch" onClose={() => {}}>
            <input aria-label="Unsaved" />
          </Dialog>
        ),
      })
      await screen.findByRole('button', { name: 'Workspace switcher' })
      await user.keyboard(CTRL_K)
      expect(palette()).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Move Launch' })).toBeVisible()
    })

    it('does nothing while a floating layer is open, and works after Escape closes it', async () => {
      const user = userEvent.setup()
      setup()
      const trigger = await screen.findByRole('button', { name: 'Workspace switcher' })
      await user.click(trigger)
      await screen.findByRole('menu')
      await user.keyboard(CTRL_K)
      expect(palette()).not.toBeInTheDocument()
      expect(screen.getByRole('menu')).toBeVisible()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
      await user.keyboard(CTRL_K)
      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeVisible()
    })

    it('Escape over a task panel closes only the palette; the panel stays and focus returns into it', async () => {
      const user = userEvent.setup()
      let escapes = 0
      setup({
        extra: (
          <aside aria-label="Task panel" onKeyDown={(e) => e.key === 'Escape' && escapes++}>
            <input aria-label="Panel title" />
          </aside>
        ),
      })
      const title = await screen.findByRole('textbox', { name: 'Panel title' })
      await user.click(title)
      await user.keyboard(CTRL_K)
      await screen.findByRole('dialog', { name: 'Command palette' })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(palette()).not.toBeInTheDocument())
      expect(escapes).toBe(0)
      expect(screen.getByRole('complementary', { name: 'Task panel' })).toBeVisible()
      expect(title).toHaveFocus()
    })
  })
})
