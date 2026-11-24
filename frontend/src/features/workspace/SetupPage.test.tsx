import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useParams } from 'react-router'
import { describe, expect, it } from 'vitest'
import { json, renderWithProviders, useStubFetch } from '../../test/api'
import { SetupPage } from './SetupPage'
import { WorkspaceRedirect } from './WorkspaceRedirect'

function Workspace() {
  return <h1>Workspace {useParams().workspaceId}</h1>
}

function renderApp(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<WorkspaceRedirect />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/w/:workspaceId" element={<Workspace />} />
    </Routes>,
    { route },
  )
}

describe('SetupPage', () => {
  it('FR-6: a user with zero Workspaces is redirected to the setup screen', async () => {
    useStubFetch({ 'GET /api/v1/workspaces': { items: [] } })
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Create your Workspace' })).toBeVisible()
  })

  it('FR-6: creating a Workspace sends name and key and navigates to it', async () => {
    const stub = useStubFetch({
      'GET /api/v1/workspaces': { items: [] },
      'POST /api/v1/workspaces': json({ id: 'w1', name: 'Acme', key: 'ACME', role: 'OWNER' }),
    })
    const user = userEvent.setup()
    renderApp('/setup')

    await user.type(screen.getByLabelText('Name'), 'Acme')
    await user.type(screen.getByLabelText('Key (optional)'), 'ACME')
    await user.click(screen.getByRole('button', { name: 'Create Workspace' }))

    expect(await screen.findByRole('heading', { name: 'Workspace w1' })).toBeVisible()
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toEqual({ name: 'Acme', key: 'ACME' })
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('FR-6: an empty name and a bad key are refused before sending', async () => {
    const stub = useStubFetch({ 'GET /api/v1/workspaces': { items: [] } })
    const user = userEvent.setup()
    renderApp('/setup')

    await user.type(screen.getByLabelText('Key (optional)'), 'a')
    await user.click(screen.getByRole('button', { name: 'Create Workspace' }))

    expect(await screen.findByText('Enter a name.')).toBeVisible()
    expect(screen.getByText('Use 2 to 6 capital letters.')).toBeVisible()
    expect(stub.count('POST', /workspaces$/)).toBe(0)
  })
})
