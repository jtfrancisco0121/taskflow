import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { WatchControl } from './WatchControl'

const watching = { watching: true, count: 1, items: [{ userId: 'u1', displayName: 'Maya' }] }

describe('CAP-10 watch control', () => {
  it('shows "Watching (1)" and changes to "Watch" when clicked', async () => {
    let state = watching
    installFetch({
      'GET /api/v1/tasks/:id/watchers': () => json(state),
      'DELETE /api/v1/tasks/:id/watch': () => {
        state = { watching: false, count: 0, items: [] }
        return json(state)
      },
    })
    const user = userEvent.setup()
    renderWithProviders(<WatchControl taskId="t1" />)
    const button = await screen.findByRole('button', { name: 'Watching (1)' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await user.click(button)
    expect(await screen.findByRole('button', { name: 'Watch' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('rolls back and tells the person when the server refuses', async () => {
    installFetch({
      'GET /api/v1/tasks/:id/watchers': () => json(watching),
      'DELETE /api/v1/tasks/:id/watch': () => problem(500, 'internal', 'Something went wrong'),
    })
    const user = userEvent.setup()
    renderWithProviders(<WatchControl taskId="t1" />)
    await user.click(await screen.findByRole('button', { name: 'Watching (1)' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Watching (1)' })).toBeVisible())
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0)
  })

  it('renders nothing when the watchers cannot be read', async () => {
    installFetch({ 'GET /api/v1/tasks/:id/watchers': () => problem(404, 'task.not_found', 'x') })
    const { container } = renderWithProviders(<WatchControl taskId="t1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
