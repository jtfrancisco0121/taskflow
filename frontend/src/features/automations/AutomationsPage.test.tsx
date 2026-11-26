import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AutomationsPage } from './AutomationsPage'
import { expectValue, findOption, optionsOf, pick } from '../../test/ui'

const baseRoutes = {
  'GET /api/v1/workspaces/:id/members': {
    items: [
      { userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' },
      { userId: 'u2', displayName: 'Omar Haddad', role: 'MEMBER' },
    ],
  },
  'GET /api/v1/locations/:id/statuses': {
    statuses: [
      { id: 'st-todo', name: 'To do', group: 'NOT_STARTED' },
      { id: 'st-done', name: 'Done', group: 'DONE' },
    ],
  },
  'GET /api/v1/locations/:id/fields': { locationId: 'l1', canEdit: true, fields: [] },
  'GET /api/v1/locations/:id': { id: 'l1', name: 'Launch', type: 'LIST', workspaceId: 'w1' },
}

const rule = (extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  locationId: 'l1',
  name: 'Done notes',
  enabled: true,
  version: 1,
  trigger: { type: 'STATUS_CHANGED', toStatuses: ['Done'] },
  conditions: [],
  actions: [{ type: 'ADD_COMMENT', text: 'Shipped' }],
  inherited: false,
  definedAt: 'l1',
  definedAtName: 'Launch',
  createdBy: { id: 'u1', name: 'Maya Lopez' },
  ...extra,
})

function serve(
  list: object,
  extra: Record<string, object | Response | ((r: Request, b: unknown) => Response)> = {},
) {
  return installFetch({
    ...baseRoutes,
    'GET /api/v1/locations/:id/automations': list,
    ...extra,
  })
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId/l/:locationId/automations" element={<AutomationsPage />} />
    </Routes>,
    { route: '/w/w1/l/l1/automations' },
  )
}

describe('CAP-8 Automations page', () => {
  it('shows the empty state with a New rule button for an editor', async () => {
    serve({ locationId: 'l1', canEdit: true, limit: 50, rules: [] })
    renderPage()
    expect(await screen.findByText('No rules here yet')).toBeVisible()
    expect(screen.getByRole('button', { name: 'New rule' })).toBeVisible()
  })

  it('shows a read-only page without a switch, Edit or Delete for a viewer', async () => {
    serve({ locationId: 'l1', canEdit: false, limit: 50, rules: [rule()] })
    renderPage()
    expect(await screen.findByText('Done notes')).toBeVisible()
    expect(screen.getByText('You can view rules here. Ask an editor to change them.')).toBeVisible()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New rule' })).toBeNull()
  })

  it('shows inherited rules read-only with where they come from', async () => {
    serve({
      locationId: 'l1',
      canEdit: true,
      limit: 50,
      rules: [rule({ inherited: true, definedAtName: 'Engineering' })],
    })
    renderPage()
    expect(await screen.findByText('From Engineering')).toBeVisible()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('creates a rule from the builder and sends the typed body', async () => {
    const stub = serve(
      { locationId: 'l1', canEdit: true, limit: 50, rules: [] },
      { 'POST /api/v1/locations/:id/automations': () => json(rule(), 201) },
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New rule' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Rule name'), 'Done notes')
    const from = within(dialog).getByLabelText('From status (optional)')
    const to = within(dialog).getByLabelText('To status (optional)')
    await findOption(user, from, 'Done')
    await findOption(user, to, 'Done')
    await pick(user, to, 'Done')
    await user.type(within(dialog).getByLabelText('Comment text'), 'Shipped')
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
    await waitFor(() => expect(stub.count('POST', /automations$/)).toBe(1))
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      name: 'Done notes',
      trigger: { type: 'STATUS_CHANGED', toStatuses: ['Done'] },
      actions: [{ type: 'ADD_COMMENT', text: 'Shipped' }],
    })
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('saves "Any status" and "A specific person (optional)" with the same payloads as before (CAP-8)', async () => {
    const stub = serve(
      { locationId: 'l1', canEdit: true, limit: 50, rules: [] },
      { 'POST /api/v1/locations/:id/automations': () => json(rule(), 201) },
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New rule' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Rule name'), 'Any status')
    const from = within(dialog).getByLabelText('From status (optional)')
    const to = within(dialog).getByLabelText('To status (optional)')
    await pick(user, from, 'Done')
    await pick(user, to, 'Done')
    // "Any status" is a real choice that stores '': picking it again clears the status.
    await pick(user, from, 'Any status')
    expectValue(from, 'Any status')
    await pick(user, within(dialog).getByLabelText('Action type'), 'Send notification')
    const person = within(dialog).getByLabelText('Person to notify')
    await pick(user, person, 'Omar Haddad')
    await pick(user, person, 'A specific person (optional)')
    expectValue(person, 'A specific person (optional)')
    await user.type(within(dialog).getByLabelText('Message'), 'Done!')
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
    await waitFor(() => expect(stub.count('POST', /automations$/)).toBe(1))
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      trigger: { type: 'STATUS_CHANGED', toStatuses: ['Done'] },
      actions: [{ type: 'SEND_NOTIFICATION', personIds: [], message: 'Done!' }],
    })
    expect((post.body as { trigger: object }).trigger).not.toHaveProperty('fromStatuses')
    // Several Selects and typing in one dialog: 0.3 s alone, but a loaded parallel run passed the 5 s default once.
  }, 20_000)

  it('never lists a "Choose a ..." prompt as an option (AD-11)', async () => {
    serve({ locationId: 'l1', canEdit: true, limit: 50, rules: [] })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New rule' }))
    const dialog = await screen.findByRole('dialog')
    await pick(user, within(dialog).getByLabelText('Action type'), 'Change status')
    const status = within(dialog).getByLabelText('Status')
    expect(status).toHaveTextContent('Choose a status')
    expect(await optionsOf(user, status)).toEqual(['To do', 'Done'])
    expect(await optionsOf(user, within(dialog).getByLabelText('From status (optional)'))).toEqual([
      'Any status',
      'To do',
      'Done',
    ])
  })

  it('shows a server error next to its field', async () => {
    serve(
      { locationId: 'l1', canEdit: true, limit: 50, rules: [] },
      {
        'POST /api/v1/locations/:id/automations': () =>
          problem(400, 'automation.invalid_action', 'That status is not offered here'),
      },
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New rule' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Rule name'), 'X')
    await user.type(within(dialog).getByLabelText('Comment text'), 'x')
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }))
    expect(await within(dialog).findByText('That status is not offered here')).toBeVisible()
  })

  it('turns the switch off at once and puts it back when the server refuses', async () => {
    serve(
      { locationId: 'l1', canEdit: true, limit: 50, rules: [rule()] },
      {
        'PATCH /api/v1/automations/:id': () =>
          problem(409, 'automation.stale', 'Someone else changed this rule.'),
      },
    )
    const user = userEvent.setup()
    renderPage()
    const toggle = await screen.findByRole('switch', { name: 'Done notes enabled' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Done notes enabled' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Someone else changed this rule.',
      ),
    )
  })

  it('answers 404 with a not-found message', async () => {
    installFetch({
      ...baseRoutes,
      'GET /api/v1/locations/:id/automations': problem(
        404,
        'location.not_found',
        'Location not found',
      ),
    })
    renderPage()
    expect(
      await screen.findByText("This location doesn't exist or you don't have access."),
    ).toBeVisible()
  })

  it('opens the run history with outcome, task link, reason and the error of a failed run', async () => {
    const run = (id: string, extra: Record<string, unknown>) => ({
      id,
      taskId: 't1',
      taskReadableId: 'ACME-1',
      taskTitle: 'Ship it',
      status: 'SUCCEEDED',
      attempt: 1,
      depth: 1,
      createdAt: new Date().toISOString(),
      ...extra,
    })
    const stub = serve(
      { locationId: 'l1', canEdit: false, limit: 50, rules: [rule()] },
      {
        'GET /api/v1/automations/:id/runs': (request) =>
          new URL(request.url).searchParams.get('cursor')
            ? json({ items: [run('r3', { status: 'SKIPPED', reason: 'conditions_not_met' })] })
            : json({
                items: [
                  run('r1', {}),
                  run('r2', { status: 'FAILED', attempt: 3, error: 'database blip' }),
                ],
                nextCursor: 'c2',
              }),
      },
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'History' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Succeeded')).toBeVisible()
    expect(within(dialog).getAllByRole('link', { name: 'ACME-1 Ship it' })[0]).toHaveAttribute(
      'href',
      '/t/t1',
    )
    expect(within(dialog).getByText('database blip')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Load more' }))
    expect(await within(dialog).findByText(/Conditions not met/)).toBeVisible()
    expect(stub.count('GET', /\/runs$/)).toBe(2)
  })
})
