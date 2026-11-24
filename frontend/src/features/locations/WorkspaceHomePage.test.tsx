import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useUiStore } from '../../shared/ui-store'
import { installFetch, renderWithProviders } from '../../test/api'
import { WorkspaceHomePage } from './WorkspaceHomePage'

function renderHome() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId" element={<WorkspaceHomePage />} />
    </Routes>,
    { route: '/w/w1' },
  )
}

describe('WorkspaceHomePage', () => {
  it('FR-6: an empty Workspace shows the prompt and Create Space opens the sidebar field', async () => {
    installFetch({ 'GET /api/v1/workspaces/:id/tree': { items: [] } })
    const user = userEvent.setup()
    renderHome()

    expect(await screen.findByText('This Workspace has no Spaces yet.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create Space' }))
    expect(useUiStore.getState().creatingSpace).toBe(true)
  })

  it('FR-8: a Workspace with Spaces says to pick a List', async () => {
    installFetch({
      'GET /api/v1/workspaces/:id/tree': { items: [{ id: 's1', name: 'M', type: 'SPACE' }] },
    })
    renderHome()

    expect(await screen.findByText('Pick a List in the sidebar.')).toBeVisible()
  })
})
