import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders, installFetch, problem } from '../../test/api'
import { writeLastWorkspace } from './lastWorkspace'
import { WorkspaceRedirect } from './WorkspaceRedirect'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const acme = { id: 'w1', name: 'Acme', role: 'OWNER' }
const beta = { id: 'w2', name: 'Beta', role: 'MEMBER' }

function Shell() {
  const { workspaceId } = useParams()
  return (
    <>
      <WorkspaceSwitcher currentId={workspaceId} />
      <p>Current {workspaceId}</p>
    </>
  )
}

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<WorkspaceRedirect />} />
      <Route path="/w/:workspaceId" element={<Shell />} />
      <Route path="/setup" element={<h1>Setup</h1>} />
    </Routes>,
    { route },
  )
}

describe('WorkspaceSwitcher', () => {
  it('FR-7: lists each Workspace with its name and role, checks the current one and offers New Workspace', async () => {
    installFetch({ 'GET /api/v1/workspaces': { items: [acme, beta] } })
    const user = userEvent.setup()
    renderApp('/w/w1')

    await user.click(await screen.findByRole('button', { name: 'Workspace switcher' }))

    const current = screen.getByRole('menuitemradio', { name: /Acme/ })
    expect(current).toHaveAttribute('aria-checked', 'true')
    expect(current).toHaveTextContent('Owner')
    expect(screen.getByRole('menuitemradio', { name: /Beta/ })).toHaveTextContent('Member')
    expect(screen.getByRole('menuitem', { name: 'New Workspace' })).toBeVisible()
  })

  it('FR-7: switching navigates to the other Workspace', async () => {
    installFetch({ 'GET /api/v1/workspaces': { items: [acme, beta] } })
    const user = userEvent.setup()
    renderApp('/w/w1')

    await user.click(await screen.findByRole('button', { name: 'Workspace switcher' }))
    await user.click(screen.getByRole('menuitemradio', { name: /Beta/ }))

    expect(await screen.findByText('Current w2')).toBeVisible()
  })

  it('FR-7: shows Show more and loads the next page with the server cursor', async () => {
    const stub = installFetch({
      'GET /api/v1/workspaces': (request) =>
        new URL(request.url).searchParams.get('cursor') === 'c2'
          ? Response.json({ items: [beta] })
          : Response.json({ items: [acme], nextCursor: 'c2' }),
    })
    const user = userEvent.setup()
    renderApp('/w/w1')

    await user.click(await screen.findByRole('button', { name: 'Workspace switcher' }))
    await user.click(screen.getByRole('menuitem', { name: 'Show more' }))

    expect(await screen.findByRole('menuitemradio', { name: /Beta/ })).toBeVisible()
    expect(stub.calls.at(-1)!.url.searchParams.get('cursor')).toBe('c2')
  })

  it('Escape closes the menu and focus returns to the switcher', async () => {
    installFetch({ 'GET /api/v1/workspaces': { items: [acme, beta] } })
    const user = userEvent.setup()
    renderApp('/w/w1')

    const trigger = await screen.findByRole('button', { name: 'Workspace switcher' })
    await user.click(trigger)
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('FR-7: / restores the last Workspace', async () => {
    installFetch({ 'GET /api/v1/workspaces': { items: [acme, beta] } })
    writeLastWorkspace('w2')
    renderApp('/')

    expect(await screen.findByText('Current w2')).toBeVisible()
  })

  it('FR-7: a last Workspace the user lost access to falls back to the first', async () => {
    installFetch({ 'GET /api/v1/workspaces': { items: [acme, beta] } })
    writeLastWorkspace('gone')
    renderApp('/')

    expect(await screen.findByText('Current w1')).toBeVisible()
  })

  // 14yq6g334bn part 2: the redirect waits for every page; a later page that fails leaves the list incomplete, so it
  // shows the error instead of guessing from page 1 (this is what `|| refreshFailed(all)` in WorkspaceRedirect reads).
  it('FR-7: / shows the error when a later page fails, and does not redirect', async () => {
    installFetch({
      'GET /api/v1/workspaces': (request) =>
        new URL(request.url).searchParams.get('cursor') === 'c2'
          ? problem(500, 'boom', 'Server broke')
          : Response.json({ items: [acme], nextCursor: 'c2' }),
    })
    writeLastWorkspace('w2')
    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('Server broke')
    expect(screen.queryByText(/^Current/)).toBeNull()
  })
})
