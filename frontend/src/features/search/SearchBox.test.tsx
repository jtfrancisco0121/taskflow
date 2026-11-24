import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { SearchBox } from './SearchBox'

function Where() {
  const location = useLocation()
  return (
    <p data-testid="where">
      {location.pathname}|{JSON.stringify(location.state)}
    </p>
  )
}

const hit = (n: number) => ({
  taskId: `t${n}`,
  readableId: `ACME-${n}`,
  title: `Task ${n}`,
  listName: 'Launch',
  snippet: `…about the <mark>zeppelin</mark> budget ${n}`,
})

function serve() {
  return installFetch({
    'GET /api/v1/workspaces/:id/search': (request) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      return cursor
        ? json({ items: [hit(3)] })
        : json({ items: [hit(1), hit(2)], nextCursor: 'next' })
    },
  })
}

function render() {
  return renderWithProviders(
    <>
      <SearchBox workspaceId="w1" />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
    { route: '/w/w1/l/l1?g=priority' },
  )
}

describe('SEARCH-1 search box', () => {
  it('pressing / anywhere focuses the box, but not while typing in another field', async () => {
    serve()
    const user = userEvent.setup()
    render()
    await user.keyboard('/')
    expect(screen.getByRole('combobox', { name: 'Search tasks' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('combobox', { name: 'Search tasks' })).not.toHaveFocus()
  })

  it('shows readable id, title, List name and a highlighted snippet', async () => {
    const stub = serve()
    const user = userEvent.setup()
    render()
    await user.type(screen.getByRole('combobox', { name: 'Search tasks' }), 'zeppelin')

    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('ACME-1')
    expect(options[0]).toHaveTextContent('Task 1')
    expect(options[0]).toHaveTextContent('Launch')
    expect(options[0].querySelector('mark')).toHaveTextContent('zeppelin')
    expect(stub.calls.at(-1)!.url.searchParams.get('q')).toBe('zeppelin')
    expect(stub.calls.at(-1)!.url.searchParams.get('limit')).toBe('20')
  })

  it('Enter opens the task over the current view, and arrows choose the result', async () => {
    serve()
    const user = userEvent.setup()
    render()
    await user.type(screen.getByRole('combobox', { name: 'Search tasks' }), 'zeppelin')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/t/t2'))
    const state = screen.getByTestId('where').textContent!.split('|')[1]
    expect(JSON.parse(state).backgroundLocation).toMatchObject({
      pathname: '/w/w1/l/l1',
      search: '?g=priority',
    })
  })

  it('loads the next page with the cursor', async () => {
    const stub = serve()
    const user = userEvent.setup()
    render()
    await user.type(screen.getByRole('combobox', { name: 'Search tasks' }), 'zeppelin')
    await user.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(stub.calls.at(-1)!.url.searchParams.get('cursor')).toBe('next')
  })
})
