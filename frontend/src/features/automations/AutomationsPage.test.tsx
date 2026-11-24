import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { AutomationsPage } from './AutomationsPage'

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
    await waitFor(() =>
      expect(within(dialog).getAllByRole('option', { name: 'Done' })).toHaveLength(2),
    )
    await user.selectOptions(within(dialog).getByLabelText('To status (optional)'), 'Done')
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
})
