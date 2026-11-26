import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { setSession } from '../../api/session'
import type { TaskView } from '../../api/types'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { CommentsTab } from './CommentsTab'

const task: TaskView = { id: 't1', workspaceId: 'w1', listId: 'l1', readableId: 'ACME-1' }

const para = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const comment = (id: string, authorId: string, authorName: string, text: string, extra = {}) => ({
  id,
  taskId: 't1',
  authorId,
  authorName,
  body: para(text),
  createdAt: new Date().toISOString(),
  ...extra,
})

function serve(initial: object[], extra: Record<string, never> = {}) {
  const store = [...initial]
  const stub = installFetch({
    'GET /api/v1/tasks/:id/comments': (request) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      if (cursor === 'c2') return json({ items: [store.at(-1)] })
      return json({ items: store.slice(0, 2), ...(store.length > 2 ? { nextCursor: 'c2' } : {}) })
    },
    'POST /api/v1/tasks/:id/comments': (_request, body) => {
      const created = comment(`c${store.length + 1}`, 'u1', 'Maya Lopez', 'posted', {
        body: (body as { body: object }).body,
      })
      store.push(created)
      return json(created, 201)
    },
    'PATCH /api/v1/comments/:id': (request, body) => {
      const id = new URL(request.url).pathname.split('/').pop()
      const found = store.find((c) => (c as { id: string }).id === id) as { body: object }
      found.body = (body as { body: object }).body
      Object.assign(found, { editedAt: new Date().toISOString() })
      return json(found)
    },
    'DELETE /api/v1/comments/:id': (request) => {
      const id = new URL(request.url).pathname.split('/').pop()
      store.splice(
        store.findIndex((c) => (c as { id: string }).id === id),
        1,
      )
      return new Response(null, { status: 204 })
    },
    'GET /api/v1/workspaces/:id/members': {
      items: [
        { userId: 'u1', displayName: 'Maya Lopez' },
        { userId: 'u2', displayName: 'Omar Haddad' },
      ],
    },
    ...extra,
  })
  return { stub, store }
}

function renderTab() {
  setSession('tok', { id: 'u1', displayName: 'Maya Lopez' })
  return renderWithProviders(<CommentsTab task={task} />)
}

describe('CommentsTab', () => {
  it('FR-19: a posted comment appears with its author and the empty composer is not sent', async () => {
    const { stub } = serve([])
    const user = userEvent.setup()
    renderTab()

    expect(await screen.findByText('No comments yet.')).toBeVisible()
    const send = screen.getByRole('button', { name: 'Comment' })
    expect(send).toBeDisabled()

    await user.click(await screen.findByRole('textbox', { name: 'Write a comment' }))
    await user.keyboard('Hello')
    await user.click(send)

    expect(await screen.findByText('Maya Lopez')).toBeVisible()
    expect(screen.queryByText('No comments yet.')).not.toBeInTheDocument()
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(JSON.stringify(post.body)).toContain('Hello')
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
    // the composer is empty again
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled())
  })

  it('FR-19: an @mention is sent as ProseMirror JSON with the member user id', async () => {
    const { stub } = serve([])
    const user = userEvent.setup()
    renderTab()

    await user.click(await screen.findByRole('textbox', { name: 'Write a comment' }))
    await user.click(await screen.findByRole('button', { name: 'Mention' }))
    await user.pointer({
      keys: '[MouseLeft]',
      target: await screen.findByRole('option', { name: 'Omar Haddad' }),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    await waitFor(() => expect(stub.calls.some((c) => c.method === 'POST')).toBe(true))
    const body = (stub.calls.find((c) => c.method === 'POST')!.body as { body: object }).body
    const mention = JSON.stringify(body)
    expect(mention).toContain('"type":"mention"')
    expect(mention).toContain('"id":"u2"')
    expect(body).toMatchObject({ type: 'doc' })
  })

  it('FR-20: only the author sees Edit and Delete', async () => {
    serve([comment('c1', 'u1', 'Maya Lopez', 'mine'), comment('c2', 'u2', 'Omar Haddad', 'theirs')])
    renderTab()

    const mine = (await screen.findByText('mine')).closest('li')!
    const theirs = (await screen.findByText('theirs')).closest('li')!
    expect(within(mine).getByRole('button', { name: 'Edit' })).toBeVisible()
    expect(within(mine).getByRole('button', { name: 'Delete' })).toBeVisible()
    expect(within(theirs).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(theirs).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('FR-20: an edited comment shows the edited marker and saves the new body', async () => {
    const { stub } = serve([comment('c1', 'u1', 'Maya Lopez', 'first')])
    const user = userEvent.setup()
    renderTab()

    const item = (await screen.findByText('first')).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Edit' }))
    const editor = within(item).getByRole('textbox', { name: 'Edit comment' })
    await user.click(editor)
    await user.keyboard(' more')
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('edited')).toBeVisible()
    const patch = stub.calls.find((c) => c.method === 'PATCH')!
    expect(JSON.stringify(patch.body)).toContain('more')
  })

  it('FR-20: delete asks for confirmation inline and then removes the comment', async () => {
    const { stub } = serve([comment('c1', 'u1', 'Maya Lopez', 'bye')])
    const user = userEvent.setup()
    renderTab()

    const item = (await screen.findByText('bye')).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Delete' }))
    expect(stub.count('DELETE', /comments/)).toBe(0)
    await user.click(within(item).getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(screen.queryByText('bye')).not.toBeInTheDocument())
    expect(stub.count('DELETE', /comments\/c1$/)).toBe(1)
  })

  it('FR-19: Show more loads the next page with the server cursor', async () => {
    const { stub } = serve([
      comment('c1', 'u2', 'Omar Haddad', 'one'),
      comment('c2', 'u2', 'Omar Haddad', 'two'),
      comment('c3', 'u2', 'Omar Haddad', 'three'),
    ])
    const user = userEvent.setup()
    renderTab()

    await screen.findByText('two')
    await user.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByText('three')).toBeVisible()
    const cursors = stub.calls
      .filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/comments'))
      .map((c) => c.url.searchParams.get('cursor'))
    expect(cursors).toEqual([null, 'c2'])
  })

  it('shows Loading…, then an error with Retry that loads the comments', async () => {
    let calls = 0
    serve([comment('c1', 'u1', 'Maya Lopez', 'first')], {
      'GET /api/v1/tasks/:id/comments': () =>
        ++calls === 1
          ? problem(500, 'boom', 'Server broke')
          : json({ items: [comment('c1', 'u1', 'Maya Lopez', 'first')] }),
    } as never)
    const user = userEvent.setup()
    renderTab()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server broke')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Maya Lopez')).toBeVisible()
  })
})
