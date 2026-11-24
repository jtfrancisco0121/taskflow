import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders, installFetch } from '../../test/api'
import { SidebarTree } from './SidebarTree'

const space = { id: 's1', name: 'Marketing', type: 'SPACE', hasChildren: true }
const secret = { id: 's2', name: 'Board', type: 'SPACE', hasChildren: false, isPrivate: true }
const folder = { id: 'f1', name: 'Q4', type: 'FOLDER', parentId: 's1', hasChildren: true }
const list = { id: 'l1', name: 'Launch', type: 'LIST', parentId: 'f1', hasChildren: false }

function tree(extra: Record<string, unknown> = {}) {
  return installFetch({
    'GET /api/v1/workspaces/:id/tree': (request) => {
      const parentId = new URL(request.url).searchParams.get('parentId')
      if (parentId === 's1') return Response.json({ items: [folder] })
      if (parentId === 'f1') return Response.json({ items: [list] })
      return Response.json({ items: [space, secret] })
    },
    ...extra,
  })
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderTree() {
  return renderWithProviders(
    <>
      <SidebarTree workspaceId="w1" />
      <Where />
    </>,
    { route: '/w/w1' },
  )
}

const treeCalls = (stub: ReturnType<typeof tree>) =>
  stub.calls
    .filter((c) => c.url.pathname.endsWith('/tree'))
    .map((c) => c.url.searchParams.get('parentId'))

describe('SidebarTree', () => {
  it('FR-8: first render requests only the root and no children', async () => {
    const stub = tree()
    renderTree()

    expect(await screen.findByRole('treeitem', { name: 'Marketing' })).toBeVisible()
    expect(treeCalls(stub)).toEqual([null])
  })

  it('FR-8: expanding a node requests that parent once and shows its children', async () => {
    const stub = tree()
    const user = userEvent.setup()
    renderTree()

    const item = await screen.findByRole('treeitem', { name: 'Marketing' })
    item.focus()
    await user.keyboard('{ArrowRight}')

    expect(await screen.findByRole('treeitem', { name: 'Q4' })).toBeVisible()
    expect(treeCalls(stub)).toEqual([null, 's1'])
    await user.keyboard('{ArrowLeft}')
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('treeitem', { name: 'Q4' })
    expect(treeCalls(stub)).toEqual([null, 's1'])
  })

  it('FR-8: shows a lock marker for private nodes and a type icon per node', async () => {
    tree()
    renderTree()

    const board = await screen.findByRole('treeitem', { name: 'Board (private)' })
    expect(within(board).getByRole('img', { name: 'Private' })).toBeVisible()
    const marketing = screen.getByRole('treeitem', { name: 'Marketing' })
    expect(marketing.querySelector('[data-icon="SPACE"]')).not.toBeNull()
  })

  it('FR-9: a stored expansion expands and loads after mount, and an unknown id is dropped', async () => {
    const stub = tree()
    localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1', 'f1', 'ghost']))
    renderTree()

    expect(await screen.findByRole('treeitem', { name: 'Launch' })).toBeVisible()
    expect(treeCalls(stub)).toEqual([null, 's1', 'f1'])
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('taskflow:tree:w1')!)).toEqual(['s1', 'f1']),
    )
    expect(screen.getByRole('treeitem', { name: 'Marketing' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('FR-9: expansion is written to storage so it survives a reload', async () => {
    tree()
    const user = userEvent.setup()
    renderTree()

    const item = await screen.findByRole('treeitem', { name: 'Marketing' })
    item.focus()
    await user.keyboard('{ArrowRight}')

    expect(JSON.parse(localStorage.getItem('taskflow:tree:w1')!)).toEqual(['s1'])
  })

  it('FR-10: arrow keys move, expand and collapse; Enter opens the List view', async () => {
    tree()
    const user = userEvent.setup()
    renderTree()

    const marketing = await screen.findByRole('treeitem', { name: 'Marketing' })
    marketing.focus()
    await user.keyboard('{ArrowRight}') // expand
    await screen.findByRole('treeitem', { name: 'Q4' })
    await user.keyboard('{ArrowRight}') // into the first child
    expect(screen.getByRole('treeitem', { name: 'Q4' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}') // back to the parent
    expect(marketing).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('treeitem', { name: 'Board (private)' })).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(marketing).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/s1')
  })

  it('FR-10: items expose level, expanded state and roving tabindex', async () => {
    tree()
    renderTree()

    const first = await screen.findByRole('treeitem', { name: 'Marketing' })
    expect(first).toHaveAttribute('aria-level', '1')
    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(first).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('treeitem', { name: 'Board (private)' })).toHaveAttribute(
      'tabindex',
      '-1',
    )
    expect(screen.getByRole('tree')).toBeVisible()
  })

  it('FR-8: a failed children request shows a Retry row', async () => {
    let fail = true
    installFetch({
      'GET /api/v1/workspaces/:id/tree': (request) => {
        const parentId = new URL(request.url).searchParams.get('parentId')
        if (parentId === 's1') {
          return fail ? new Response('{}', { status: 500 }) : Response.json({ items: [folder] })
        }
        return Response.json({ items: [space] })
      },
    })
    const user = userEvent.setup()
    renderTree()

    const item = await screen.findByRole('treeitem', { name: 'Marketing' })
    item.focus()
    await user.keyboard('{ArrowRight}')
    fail = false
    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('treeitem', { name: 'Q4' })).toBeVisible()
  })
})
