import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { json, problem, renderWithProviders, installFetch } from '../../test/api'
import { SidebarTree } from './SidebarTree'

type N = {
  id: string
  name: string
  type: 'SPACE' | 'FOLDER' | 'LIST'
  parentId?: string
  hasChildren: boolean
  isPrivate?: boolean
}

/** An in-memory backend for the tree endpoints. */
function backend(initial: N[], options: { moveError?: Response } = {}) {
  const nodes = initial.map((n) => ({ ...n }))
  let seq = 0
  const childrenOf = (parent: string | null) =>
    nodes
      .filter((n) => (n.parentId ?? null) === parent)
      .map((n) => ({ ...n, hasChildren: nodes.some((c) => c.parentId === n.id) }))
  const stub = installFetch({
    'GET /api/v1/workspaces/:id/tree': (request) => {
      const parentId = new URL(request.url).searchParams.get('parentId')
      return json({ items: childrenOf(parentId) })
    },
    'POST /api/v1/locations': (_request, body) => {
      const b = body as { name: string; type: N['type']; parentId?: string; isPrivate?: boolean }
      const node: N = {
        id: `new${++seq}`,
        name: b.name,
        type: b.type,
        parentId: b.parentId,
        hasChildren: false,
        isPrivate: b.isPrivate,
      }
      nodes.push(node)
      if (b.type === 'FOLDER') {
        nodes.push({
          id: `auto${seq}`,
          name: 'List',
          type: 'LIST',
          parentId: node.id,
          hasChildren: false,
        })
      }
      return json(node)
    },
    'PATCH /api/v1/locations/:id': (request, body) => {
      const id = new URL(request.url).pathname.split('/').pop()
      const node = nodes.find((n) => n.id === id)!
      Object.assign(node, body)
      return json(node)
    },
    'POST /api/v1/locations/:id/move': (request, body) => {
      if (options.moveError) return options.moveError.clone()
      const id = new URL(request.url).pathname.split('/').at(-2)
      nodes.find((n) => n.id === id)!.parentId = (body as { parentId: string }).parentId
      return json({})
    },
  })
  return { stub, nodes }
}

const base: N[] = [
  { id: 's1', name: 'Marketing', type: 'SPACE', hasChildren: true },
  { id: 's2', name: 'Ops', type: 'SPACE', hasChildren: true },
  { id: 'f1', name: 'Q4', type: 'FOLDER', parentId: 's1', hasChildren: true },
  { id: 'l1', name: 'Launch', type: 'LIST', parentId: 'f1', hasChildren: false },
  { id: 'f2', name: 'Runbooks', type: 'FOLDER', parentId: 's2', hasChildren: false },
]

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

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${name}` }))
  return screen.getByRole('menu', { name: `${name} actions` })
}

const items = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)

describe('Location actions', () => {
  it('FR-11: the menu offers only valid actions per type', async () => {
    backend(base)
    localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1', 'f1']))
    const user = userEvent.setup()
    renderTree()

    expect(items(await openMenu(user, 'Marketing'))).toEqual([
      'New Folder',
      'New List',
      'Rename',
      'Make private',
      'Statuses',
    ])
    await user.keyboard('{Escape}')
    await screen.findByRole('treeitem', { name: 'Launch' })
    expect(items(await openMenu(user, 'Q4'))).toEqual([
      'New List',
      'Rename',
      'Make private',
      'Move',
      'Statuses',
    ])
    await user.keyboard('{Escape}')
    expect(items(await openMenu(user, 'Launch'))).toEqual([
      'Rename',
      'Make private',
      'Move',
      'Statuses',
    ])
  })

  it('FR-11: creating a Folder shows its first List, selects it and sends the parent', async () => {
    const { stub } = backend(base)
    const user = userEvent.setup()
    renderTree()

    await user.click(await screen.findByRole('button', { name: 'Actions for Marketing' }))
    await user.click(screen.getByRole('menuitem', { name: 'New Folder' }))
    await user.type(screen.getByRole('textbox', { name: 'New Folder name' }), 'Brand{Enter}')

    expect(await screen.findByRole('treeitem', { name: 'Brand' })).toBeVisible()
    expect(await screen.findByRole('treeitem', { name: 'List' })).toBeVisible() // its first List
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      workspaceId: 'w1',
      name: 'Brand',
      type: 'FOLDER',
      parentId: 's1',
    })
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/w/w1/l/new1'))
  })

  it('FR-11: "New Space" creates a Space from the sidebar header', async () => {
    const { stub } = backend(base)
    const user = userEvent.setup()
    renderTree()

    await user.click(await screen.findByRole('button', { name: 'New Space' }))
    await user.type(screen.getByRole('textbox', { name: 'New Space name' }), 'Sales{Enter}')

    expect(await screen.findByRole('treeitem', { name: 'Sales' })).toBeVisible()
    expect(stub.calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      type: 'SPACE',
      name: 'Sales',
    })
  })

  it('FR-11: Escape cancels the inline field and sends nothing', async () => {
    const { stub } = backend(base)
    const user = userEvent.setup()
    renderTree()

    await user.click(await screen.findByRole('button', { name: 'New Space' }))
    await user.type(screen.getByRole('textbox', { name: 'New Space name' }), 'Sales{Escape}')

    expect(screen.queryByRole('textbox', { name: 'New Space name' })).not.toBeInTheDocument()
    expect(stub.count('POST', /locations$/)).toBe(0)
  })

  it('FR-12: rename updates the tree and an empty name is not sent', async () => {
    const { stub } = backend(base)
    const user = userEvent.setup()
    renderTree()

    await openMenu(user, 'Marketing')
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Rename Marketing' })
    await user.clear(field)
    await user.keyboard('{Enter}')
    expect(stub.count('PATCH', /locations/)).toBe(0)

    await user.type(field, 'Growth{Enter}')

    expect(await screen.findByRole('treeitem', { name: 'Growth' })).toBeVisible()
    expect(stub.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ name: 'Growth' })
  })

  it('FR-12: privacy toggle sends isPrivate and shows the lock marker', async () => {
    const { stub } = backend(base)
    const user = userEvent.setup()
    renderTree()

    await openMenu(user, 'Marketing')
    await user.click(screen.getByRole('menuitem', { name: 'Make private' }))

    const item = await screen.findByRole('treeitem', { name: 'Marketing (private)' })
    expect(within(item).getByRole('img', { name: 'Private' })).toBeVisible()
    expect(stub.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ isPrivate: true })
  })

  it('FR-22: the Statuses action opens the dialog for that location', async () => {
    backend(base)
    installFetch({
      'GET /api/v1/workspaces/:id/tree': { items: [base[0]] },
      'GET /api/v1/locations/:id/statuses': { locationId: 's1', definedAt: 's1', statuses: [] },
    })
    const user = userEvent.setup()
    renderTree()

    await openMenu(user, 'Marketing')
    await user.click(screen.getByRole('menuitem', { name: 'Statuses' }))

    expect(await screen.findByRole('dialog', { name: 'Statuses: Marketing' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('FR-13: a Space has no Move action', async () => {
    backend(base)
    const user = userEvent.setup()
    renderTree()

    const menu = await openMenu(user, 'Marketing')
    expect(within(menu).queryByRole('menuitem', { name: 'Move' })).not.toBeInTheDocument()
  })

  it('FR-13: the move dialog lists valid parents only and the node appears under the new parent', async () => {
    const { stub } = backend(base)
    localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1', 'f1']))
    const user = userEvent.setup()
    renderTree()

    await screen.findByRole('treeitem', { name: 'Launch' })
    await openMenu(user, 'Launch')
    await user.click(screen.getByRole('menuitem', { name: 'Move' }))

    const dialog = await screen.findByRole('dialog', { name: 'Move Launch' })
    await within(dialog).findByRole('radio', { name: /Runbooks/ })
    expect(within(dialog).getByRole('radio', { name: /Marketing/ })).toBeEnabled()
    expect(within(dialog).getByRole('radio', { name: /Ops/ })).toBeEnabled()
    expect(within(dialog).getByRole('radio', { name: /Q4/ })).toBeDisabled() // current parent
    expect(within(dialog).queryByRole('radio', { name: /Launch/ })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('radio', { name: /Runbooks/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(stub.calls.find((c) => c.url.pathname.endsWith('/move'))!.body).toEqual({
      parentId: 'f2',
    })
    expect(await screen.findByRole('treeitem', { name: 'Launch' })).toBeVisible()
    expect(
      within(await screen.findByRole('treeitem', { name: 'Runbooks' })).getByRole('treeitem', {
        name: 'Launch',
      }),
    ).toBeVisible()
  })

  it('FR-13: a Folder can only move under Spaces', async () => {
    backend(base)
    localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1']))
    const user = userEvent.setup()
    renderTree()

    await screen.findByRole('treeitem', { name: 'Q4' })
    await openMenu(user, 'Q4')
    await user.click(screen.getByRole('menuitem', { name: 'Move' }))

    const dialog = await screen.findByRole('dialog', { name: 'Move Q4' })
    await within(dialog).findByRole('radio', { name: /Ops/ })
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2) // Marketing (current, disabled) and Ops
    expect(within(dialog).getByRole('radio', { name: /Marketing/ })).toBeDisabled()
    expect(within(dialog).queryByRole('radio', { name: /Runbooks/ })).not.toBeInTheDocument()
  })

  it('FR-13: a refused move shows the server message, keeps the dialog and leaves the tree unchanged', async () => {
    backend(base, {
      moveError: problem(
        409,
        'location.move_conflict',
        'A List with that name already exists there.',
      ),
    })
    localStorage.setItem('taskflow:tree:w1', JSON.stringify(['s1', 'f1']))
    const user = userEvent.setup()
    renderTree()

    await screen.findByRole('treeitem', { name: 'Launch' })
    await openMenu(user, 'Launch')
    await user.click(screen.getByRole('menuitem', { name: 'Move' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('radio', { name: /Ops/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Move' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A List with that name already exists there.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    const q4 = screen.getByRole('treeitem', { name: 'Q4' })
    expect(within(q4).getByRole('treeitem', { name: 'Launch' })).toBeVisible()
  })
})
