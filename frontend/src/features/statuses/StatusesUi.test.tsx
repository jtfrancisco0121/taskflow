import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { StatusesDialog, type StatusesLocation } from './StatusesDialog'

const list: StatusesLocation = { id: 'L', name: 'Launch', type: 'LIST', parentId: 'S' }
const own = [{ id: 's1', name: 'Backlog', group: 'NOT_STARTED', color: '#9ca3af' }]

function open() {
  return renderWithProviders(<StatusesDialog workspaceId="w1" location={list} onClose={() => {}} />)
}

describe('slice 9b status manager', () => {
  it('9b-7: the dialog shows a loading status, then an error with Retry', async () => {
    let state: 'loading' | 'fail' | 'ok' = 'loading'
    installFetch({
      'GET /api/v1/locations/:id/statuses': () =>
        state === 'loading'
          ? new Promise<Response>(() => {})
          : state === 'fail'
            ? problem(500, 'internal', 'Statuses are down')
            : json({ inheritedFrom: null, statuses: own }),
    })
    const view = open()
    expect(await screen.findByRole('status', { name: 'Loading statuses' })).toBeVisible()
    view.unmount()

    state = 'fail'
    open()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Statuses are down')
    state = 'ok'
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Defined here')).toBeVisible()
  })

  it('9b-8: the reset panel shows an error with Retry when the parent set fails to load', async () => {
    let parentFails = true
    installFetch({
      'GET /api/v1/locations/:id': json({ id: 'L', name: 'Launch' }),
      'GET /api/v1/locations/:id/statuses': (request) => {
        const id = new URL(request.url).pathname.split('/').at(-2)
        if (id === 'L') return json({ inheritedFrom: null, statuses: own })
        return parentFails
          ? problem(500, 'internal', 'Parent set is down')
          : json({ inheritedFrom: null, statuses: own })
      },
    })
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'Reset to inherited' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Parent set is down')
    parentFails = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Reset to the inherited set\?/)).toBeVisible()
  })
})
