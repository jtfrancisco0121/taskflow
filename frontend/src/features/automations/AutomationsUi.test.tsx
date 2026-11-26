import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { pick } from '../../test/ui'
import { AutomationsPage } from './AutomationsPage'

const base = {
  'GET /api/v1/workspaces/:id/members': {
    items: [{ userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' }],
  },
  'GET /api/v1/locations/:id/statuses': {
    statuses: [{ id: 'st-todo', name: 'To do', group: 'NOT_STARTED' }],
  },
  'GET /api/v1/locations/:id/fields': { locationId: 'l1', canEdit: true, fields: [] },
  'GET /api/v1/locations/:id': { id: 'l1', name: 'Launch', type: 'LIST', workspaceId: 'w1' },
}

const rule = {
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
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId/l/:locationId/automations" element={<AutomationsPage />} />
    </Routes>,
    { route: '/w/w1/l/l1/automations' },
  )
}

describe('slice 9b automations', () => {
  it('9b-1: shows a loading status with skeletons under the page header', async () => {
    installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': () => new Promise<Response>(() => {}),
    })
    renderPage()
    expect(await screen.findByRole('status', { name: 'Loading automations' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Automations' })).toBeVisible()
  })

  it('9b-2: a failed load shows an error with Retry that loads the rules again', async () => {
    let fail = true
    installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': () =>
        fail
          ? problem(500, 'internal', 'Rules are down')
          : json({ locationId: 'l1', canEdit: true, limit: 50, rules: [rule] }),
    })
    const user = userEvent.setup()
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Rules are down')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Done notes')).toBeVisible()
  })

  it('9b-3: no rules is an empty state; an editor is told what a rule does', async () => {
    installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': {
        locationId: 'l1',
        canEdit: true,
        limit: 50,
        rules: [],
      },
    })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'No rules here yet' })).toBeVisible()
    expect(screen.getByText(/A rule runs actions when something happens/)).toBeVisible()
  })

  it('9b-4: the rule switch is the library switch and toggles with the keyboard', async () => {
    const stub = installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': {
        locationId: 'l1',
        canEdit: true,
        limit: 50,
        rules: [rule],
      },
      'PATCH /api/v1/automations/:id': () => json({ ...rule, enabled: false, version: 2 }),
    })
    const user = userEvent.setup()
    renderPage()
    const toggle = await screen.findByRole('switch', { name: 'Done notes enabled' })
    expect(toggle).toHaveAttribute('data-state', 'checked')
    toggle.focus()
    await user.keyboard(' ')
    await waitFor(() => expect(stub.count('PATCH', /automations\/r1$/)).toBe(1))
    expect(stub.calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({ enabled: false })
  })

  it('9b-5: the run history has loading, error with Retry and empty states', async () => {
    let state: 'loading' | 'fail' | 'ok' = 'loading'
    installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': {
        locationId: 'l1',
        canEdit: true,
        limit: 50,
        rules: [rule],
      },
      'GET /api/v1/automations/:id/runs': () =>
        state === 'loading'
          ? new Promise<Response>(() => {})
          : state === 'fail'
            ? problem(500, 'internal', 'History is down')
            : json({ items: [], nextCursor: null }),
    })
    const user = userEvent.setup()
    const view = renderPage()
    await user.click(await screen.findByRole('button', { name: 'History' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('status', { name: 'Loading runs' })).toBeVisible()
    view.unmount()

    state = 'fail'
    renderPage()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'History' }))
    const failed = await screen.findByRole('dialog')
    const alert = await within(failed).findByRole('alert')
    expect(alert).toHaveTextContent('History is down')
    state = 'ok'
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await within(failed).findByRole('heading', { name: 'No runs yet' })).toBeVisible()
  })

  it('9b-6: builder options are library checkboxes that toggle with the keyboard', async () => {
    installFetch({
      ...base,
      'GET /api/v1/locations/:id/automations': {
        locationId: 'l1',
        canEdit: true,
        limit: 50,
        rules: [],
      },
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'New rule' }))
    const dialog = await screen.findByRole('dialog')
    await pick(user, within(dialog).getByLabelText('Action type'), 'Assign')
    const box = within(dialog).getByRole('checkbox', { name: 'Unassign everyone' })
    expect(box).toHaveAttribute('data-state', 'unchecked')
    box.focus()
    await user.keyboard(' ')
    expect(box).toHaveAttribute('data-state', 'checked')
  })
})
