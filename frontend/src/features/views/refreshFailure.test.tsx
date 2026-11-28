import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { BoardRenderer } from './BoardRenderer'
import { CalendarRenderer } from './CalendarRenderer'
import { ListRenderer } from './ListRenderer'
import { TableRenderer } from './TableRenderer'
import { baseRoutes, scope, task } from './testSupport'
import { LocationViewRoute } from './ViewPage'

// ClickUp 14yq6g334fe: a background refresh that fails keeps the rows a view already shows, with a non-blocking
// Retry notice; only a failed first load replaces the view with the error state.
const notice = () => screen.queryByRole('status', { name: 'Couldn’t refresh' })
const rows = () => json({ items: [task(1), task(2)].map((t) => ({ group: 'to do', task: t })) })

/** Serves the view query, failing it while `state.fail` is set. */
function serve(state: { fail: boolean }, extra: Record<string, unknown> = {}) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () =>
      state.fail ? problem(500, 'internal.error', 'The request failed') : rows(),
    ...extra,
  })
}

async function failRefresh(
  state: { fail: boolean },
  queryClient: { refetchQueries: () => Promise<void> },
) {
  state.fail = true
  await act(() => queryClient.refetchQueries())
}

const renderers: [string, ReactElement, string][] = [
  ['List', <ListRenderer scope={scope} config={{ v: 1 }} />, 'Task 1'],
  ['Table', <TableRenderer scope={scope} config={{ v: 1 }} update={vi.fn()} />, 'Task 1'],
  ['Board', <BoardRenderer scope={scope} config={{ v: 1, group: 'status' }} />, 'Task 1'],
]

describe('a failed background refresh keeps the view (14yq6g334fe)', () => {
  it.each(renderers)(
    '%s keeps its rows and shows a Retry notice that recovers',
    async (_n, ui, row) => {
      const state = { fail: false }
      serve(state)
      const user = userEvent.setup()
      const { queryClient } = renderWithProviders(ui, { route: '/w/w1/l/l1' })
      expect((await screen.findAllByText(row))[0]).toBeVisible()

      await failRefresh(state, queryClient)
      expect(await screen.findByRole('status', { name: 'Couldn’t refresh' })).toBeVisible()
      expect(screen.getAllByText(row)[0]).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()

      state.fail = false
      await user.click(within(notice()!).getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(notice()).toBeNull())
      expect(screen.getAllByText(row)[0]).toBeVisible()
    },
  )

  it('Calendar keeps its grid and shows a Retry notice', async () => {
    const state = { fail: false }
    serve(state)
    const { queryClient } = renderWithProviders(
      <CalendarRenderer scope={scope} config={{ v: 1, mode: 'month' }} update={vi.fn()} />,
      { route: '/w/w1/l/l1/v/cal' },
    )
    expect(await screen.findByRole('grid', { name: 'Calendar' })).toBeVisible()
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    await failRefresh(state, queryClient)
    expect(await screen.findByRole('status', { name: 'Couldn’t refresh' })).toBeVisible()
    expect(screen.getByRole('grid', { name: 'Calendar' })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the view page keeps the view when its list of views fails to refresh', async () => {
    const state = { fail: false }
    serve(state, {
      'GET /api/v1/locations/:id/views': () =>
        state.fail
          ? problem(500, 'internal.error', 'The request failed')
          : json({
              items: [{ defaultKind: 'LIST', name: 'List', type: 'LIST', config: { v: 1 } }],
            }),
      'POST /api/v1/views/query': rows,
    })
    const { queryClient } = renderWithProviders(
      <Routes>
        <Route path="/w/:workspaceId/l/:locationId" element={<LocationViewRoute />} />
      </Routes>,
      { route: '/w/w1/l/l1' },
    )
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()

    await failRefresh(state, queryClient)
    expect(await screen.findByRole('status', { name: 'Couldn’t refresh' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Task 1' })).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a refresh of the views that fails with 404 shows only the error, not the stale view', async () => {
    const state = { fail: false }
    serve(state, {
      'GET /api/v1/locations/:id/views': () =>
        state.fail
          ? problem(404, 'location.not_found', 'Gone')
          : json({
              items: [{ defaultKind: 'LIST', name: 'List', type: 'LIST', config: { v: 1 } }],
            }),
      'POST /api/v1/views/query': rows,
    })
    const { queryClient } = renderWithProviders(
      <Routes>
        <Route path="/w/:workspaceId/l/:locationId" element={<LocationViewRoute />} />
      </Routes>,
      { route: '/w/w1/l/l1' },
    )
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()

    state.fail = true
    await act(() => queryClient.refetchQueries({ queryKey: ['ws', 'w1', 'viewList'] }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Task 1' })).toBeNull())
    expect(screen.getByRole('alert')).toBeVisible()
    expect(notice()).toBeNull()
  })

  it('a failed first load still shows the error state with Retry, and no refresh notice', async () => {
    serve({ fail: true })
    renderWithProviders(<ListRenderer scope={scope} config={{ v: 1 }} />, { route: '/w/w1/l/l1' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The request failed')
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(notice()).toBeNull()
    expect(screen.queryByText('Task 1')).toBeNull()
  })
})
