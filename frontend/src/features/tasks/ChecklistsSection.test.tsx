import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { setSession } from '../../api/session'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { ChecklistsSection } from './ChecklistsSection'
import type { Checklist } from './useChecklists'

const item = (id: string, text: string, checked = false) => ({ id, text, checked })
const view = (items: object[] = [], name = 'Release'): Checklist =>
  ({ id: 'k1', taskId: 't1', name, items }) as Checklist
const members = (role = 'MEMBER') => ({
  items: [{ userId: 'u1', displayName: 'Maya Lopez', role }],
})

function renderSection(
  initial: Checklist[],
  routes: Record<string, unknown> = {},
  role = 'MEMBER',
) {
  setSession('tok', { id: 'u1', displayName: 'Maya Lopez' })
  const stub = installFetch({
    'GET /api/v1/tasks/:id/checklists': json(initial),
    'GET /api/v1/workspaces/:id/members': members(role),
    ...routes,
  } as never)
  const { queryClient } = renderWithProviders(<ChecklistsSection taskId="t1" workspaceId="w1" />)
  return Object.assign(stub, { queryClient })
}

describe('ChecklistsSection', () => {
  it('shows the empty text, and creates a checklist named Checklist with its name field focused', async () => {
    renderSection([], { 'POST /api/v1/tasks/:id/checklists': json(view([], 'Checklist')) })
    const user = userEvent.setup()
    expect(await screen.findByText('No checklists yet.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add checklist' }))
    expect(await screen.findByRole('textbox', { name: 'Checklist name' })).toHaveFocus()
  })

  it('renames on Enter, adds and checks items, edits an item, and deletes item and checklist', async () => {
    // a small stateful server: every write returns the whole checklist
    const state = view([item('i1', 'Write notes')])
    const stub = renderSection([state], {
      'PATCH /api/v1/checklists/:id': (_r: Request, body: unknown) => {
        state.name = (body as { name: string }).name
        return json(state)
      },
      'POST /api/v1/checklists/:id/items': (_r: Request, body: unknown) => {
        state.items = [...state.items!, item('i2', (body as { text: string }).text)]
        return json(state)
      },
      'PATCH /api/v1/checklist-items/:id': (request: Request, body: unknown) => {
        const id = new URL(request.url).pathname.split('/').at(-1)
        state.items = state.items!.map((i) => (i.id === id ? { ...i, ...(body as object) } : i))
        return json(state)
      },
      'DELETE /api/v1/checklist-items/:id': (request: Request) => {
        const id = new URL(request.url).pathname.split('/').at(-1)
        state.items = state.items!.filter((i) => i.id !== id)
        return new Response(null, { status: 200 })
      },
      'DELETE /api/v1/checklists/:id': new Response(null, { status: 200 }),
    })
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Checklist name' })
    await user.clear(name)
    await user.type(name, 'Launch{Enter}')
    await screen.findByRole('region', { name: 'Checklist Launch' })

    await user.type(screen.getByRole('textbox', { name: 'Add an item to Launch' }), 'Ship{Enter}')
    expect(await screen.findByRole('checkbox', { name: 'Ship' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Add an item to Launch' })).toHaveFocus()

    await user.click(screen.getByRole('checkbox', { name: 'Write notes' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Write notes' })).toBeChecked())
    expect(screen.getByText('1/2')).toBeVisible()

    const edit = screen.getByRole('textbox', { name: 'Edit item Ship' })
    await user.clear(edit)
    await user.type(edit, 'Ship it{Enter}')
    expect(
      stub.calls.some(
        (c) => c.method === 'PATCH' && JSON.stringify(c.body) === '{"text":"Ship it"}',
      ),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Delete item Write notes' }))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Write notes' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Delete checklist Launch' }))
    expect(await screen.findByText('No checklists yet.')).toBeVisible()
  })

  it('a refusal shows the server message and restores the previous state', async () => {
    renderSection([view([item('i1', 'One')])], {
      'PATCH /api/v1/checklist-items/:id': problem(400, 'x', 'Not allowed'),
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('checkbox', { name: 'One' }))
    expect(await screen.findByText('Not allowed')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'One' })).not.toBeChecked()
  })

  it('a guest sees checklists and items read-only', async () => {
    renderSection([view([item('i1', 'One', true)])], {}, 'GUEST')
    expect(await screen.findByRole('heading', { name: 'Release' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'One' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add checklist' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('1/1')).toBeVisible()
  })

  it('shows an error with Retry', async () => {
    let calls = 0
    renderSection([], {
      'GET /api/v1/tasks/:id/checklists': () =>
        ++calls === 1 ? problem(500, 'boom', 'Server broke') : json([]),
    })
    const user = userEvent.setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Server broke')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No checklists yet.')).toBeVisible()
  })

  it('Escape in an item draft cancels it and does not reach the detail', async () => {
    renderSection([view([item('i1', 'One')])])
    let escapes = 0
    document.addEventListener('keydown', (e) => e.key === 'Escape' && escapes++)
    const user = userEvent.setup()
    const edit = await screen.findByRole('textbox', { name: 'Edit item One' })
    await user.type(edit, ' more{Escape}')
    expect(edit).toHaveValue('One')
    expect(within(document.body).getByRole('region', { name: 'Checklist Release' })).toBeVisible()
    expect(escapes).toBe(0)
  })
})

// 14yq6g334bn part 2: after a refresh that fails with 403 or 404 the checklists are gone or hidden, so only the error
// shows; a 500 keeps the last checklists under the Retry notice.
describe('ChecklistsSection after a failed refresh (14yq6g334bn)', () => {
  function failing(code: number) {
    let fail = false
    const stub = renderSection([], {
      'GET /api/v1/tasks/:id/checklists': () =>
        fail ? problem(code, 'x', 'No') : json([view([item('i1', 'Write notes')])]),
    })
    return {
      ...stub,
      fail: () => {
        fail = true
        return act(() => stub.queryClient.refetchQueries({ queryKey: queryKeys.checklists('t1') }))
      },
    }
  }

  it.each([403, 404])('a %i refresh shows the error and no stale checklist', async (code) => {
    const { fail } = failing(code)
    expect(await screen.findByRole('checkbox', { name: 'Write notes' })).toBeVisible()
    await fail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the checklists')
    expect(screen.queryByRole('checkbox', { name: 'Write notes' })).toBeNull()
    expect(screen.queryByRole('status', { name: 'Couldn’t refresh' })).toBeNull()
  })

  it('a 500 refresh keeps the checklist under the Retry notice', async () => {
    const { fail } = failing(500)
    expect(await screen.findByRole('checkbox', { name: 'Write notes' })).toBeVisible()
    await fail()
    expect(await screen.findByRole('status', { name: 'Couldn’t refresh' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Write notes' })).toBeVisible()
  })
})
