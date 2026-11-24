import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { baseRoutes, task } from './testSupport'
import { parseUrlState } from './urlState'
import { LocationViewRoute } from './ViewPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

const views = {
  items: [
    { defaultKind: 'LIST', name: 'List', type: 'LIST', config: { v: 1, group: 'status' } },
    { defaultKind: 'BOARD', name: 'Board', type: 'BOARD', config: { v: 1, group: 'status' } },
  ],
}

function serve() {
  return installFetch({
    ...baseRoutes,
    'GET /api/v1/locations/:id/views': views,
    'POST /api/v1/views/query': (_r: Request, body: unknown) => {
      const filter = (body as { config: { filter?: { items?: Array<{ value?: string[] }> } } })
        .config.filter
      const urgentOnly = filter?.items?.[0]?.value?.includes('URGENT')
      const all = [task(1, { priority: 'URGENT' }), task(2), task(3)]
      return json({
        items: (urgentOnly ? all.slice(0, 1) : all).map((t) => ({ group: 'to do', task: t })),
        groups: [{ key: 'to do', label: 'To do', count: urgentOnly ? 1 : 3 }],
      })
    },
  })
}

function renderPage(route = '/w/w1/l/l1') {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/w/:workspaceId/l/:locationId" element={<LocationViewRoute />} />
        <Route path="/w/:workspaceId/l/:locationId/v/:viewId" element={<LocationViewRoute />} />
      </Routes>
      <Where />
    </>,
    { route },
  )
}

describe('VIEW-3 view page and URL state', () => {
  it('opens a List with the List and Board tabs first and the List title', async () => {
    serve()
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeVisible()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['List', 'Board'])
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Add a task' })).toBeVisible()
  })

  it('adding "Priority is Urgent" puts f in the URL at once and narrows the rows; Back undoes it', async () => {
    serve()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: 'Task 3' })

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: '+ Add filter' }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Task 3' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'Task 1' })).toBeVisible()
    const search = screen.getByTestId('where').textContent!.split('?')[1]
    expect(parseUrlState(new URLSearchParams(search)).state.f?.items?.[0]).toMatchObject({
      field: 'priority',
      op: 'any_of',
      value: ['URGENT'],
    })
    expect(screen.getByRole('button', { name: 'Save view' })).toBeVisible()
  })

  it('an invalid parameter is dropped with a notice and the page still renders', async () => {
    serve()
    useToastStore.setState({ toasts: [] })
    renderPage('/w/w1/l/l1?g=planets&s=title.asc')
    expect(await screen.findByRole('link', { name: 'Task 1' })).toBeVisible()
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Ignored an invalid view parameter (g).',
      ),
    )
    await waitFor(() =>
      expect(screen.getByTestId('where').textContent).toBe('/w/w1/l/l1?s=title.asc'),
    )
  })

  it('grouping and sort changes go to the URL', async () => {
    serve()
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: 'Task 1' })
    await user.selectOptions(screen.getByLabelText('Group by'), 'priority')
    await user.selectOptions(screen.getByLabelText('Sort by'), 'dueDate')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('g=priority'))
    expect(screen.getByTestId('where').textContent).toContain('s=dueDate.asc')
  })
})
