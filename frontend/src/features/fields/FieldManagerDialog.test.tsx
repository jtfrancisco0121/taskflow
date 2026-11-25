import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { FieldManagerDialog, type FieldsLocation } from './FieldManagerDialog'
import { pick } from '../../test/ui'

type Field = Record<string, unknown>

const space: FieldsLocation = { id: 'S', name: 'Engineering', type: 'SPACE' }
const list: FieldsLocation = { id: 'L', name: 'Platform', type: 'LIST', parentId: 'S' }

const points = (extra: Field = {}): Field => ({
  id: 'f-points',
  name: 'Story points',
  type: 'NUMBER',
  config: { decimals: 0 },
  options: [],
  definedAt: 'S',
  definedAtName: 'Engineering',
  inherited: true,
  hidden: false,
  version: 1,
  ...extra,
})

const own = (name: string, extra: Field = {}): Field => ({
  id: `own-${name}`,
  name,
  type: 'TEXT',
  config: {},
  options: [],
  definedAt: 'L',
  definedAtName: 'Platform',
  inherited: false,
  hidden: false,
  version: 1,
  ...extra,
})

function open(location: FieldsLocation) {
  return renderWithProviders(
    <FieldManagerDialog workspaceId="w1" location={location} onClose={() => {}} />,
  )
}

describe('FieldManagerDialog', () => {
  it('FIELD-1: an empty location shows the empty state and a New field button', async () => {
    installFetch({
      'GET /api/v1/locations/:id/fields': { locationId: 'S', canEdit: true, fields: [] },
    })
    open(space)

    expect(
      await screen.findByText(
        'No fields here yet. Fields you add apply to every task below Engineering.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'New field' })).toBeVisible()
    // A Space has no Inherited list.
    expect(screen.queryByRole('heading', { name: 'Inherited' })).not.toBeInTheDocument()
  })

  it('shows a loading skeleton while the fields load', async () => {
    installFetch({
      'GET /api/v1/locations/:id/fields': () => new Promise<Response>(() => {}),
    })
    open(space)

    expect(await screen.findByRole('status', { name: 'Loading fields' })).toBeVisible()
  })

  it('shows an error with Retry when the fields cannot load', async () => {
    let calls = 0
    installFetch({
      'GET /api/v1/locations/:id/fields': () => {
        calls += 1
        return calls === 1
          ? problem(500, 'internal.error', 'The request failed')
          : json({ locationId: 'S', canEdit: true, fields: [] })
      },
    })
    const user = userEvent.setup()
    open(space)

    expect(await screen.findByRole('alert')).toHaveTextContent('The request failed')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/No fields here yet/)).toBeVisible()
  })

  it('FIELD-2: an inherited field says where it comes from and can be hidden then unhidden', async () => {
    let hidden = false
    const stub = installFetch({
      'GET /api/v1/locations/:id/fields': () =>
        json({ locationId: 'L', canEdit: true, fields: [points({ hidden })] }),
      'PUT /api/v1/locations/:id/fields/:fieldId/hidden': () => {
        hidden = true
        return json({ locationId: 'L', canEdit: true, fields: [points({ hidden })] })
      },
      'DELETE /api/v1/locations/:id/fields/:fieldId/hidden': () => {
        hidden = false
        return json({ locationId: 'L', canEdit: true, fields: [points({ hidden })] })
      },
    })
    const user = userEvent.setup()
    open(list)

    const inherited = await screen.findByRole('heading', { name: 'Inherited' })
    expect(inherited).toBeVisible()
    expect(screen.getByText('from Engineering')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Hide Story points' }))
    expect(
      await screen.findByText("Hidden here. Tasks in Platform won't show Story points."),
    ).toBeVisible()
    expect(
      stub.calls.some((c) => c.method === 'PUT' && c.url.pathname.endsWith('/f-points/hidden')),
    ).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Unhide Story points' }))
    await waitFor(() => expect(screen.queryByText(/Hidden here/)).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Hide Story points' })).toBeVisible()
  })

  it('FIELD-1: creating a Dropdown sends its Options and refreshes the list', async () => {
    const fields: Field[] = []
    const stub = installFetch({
      'GET /api/v1/locations/:id/fields': () => json({ locationId: 'S', canEdit: true, fields }),
      'POST /api/v1/locations/:id/fields': (_request, body) => {
        const b = body as { name: string; type: string; options?: { name: string }[] }
        fields.push(
          own(b.name, {
            type: b.type,
            options: (b.options ?? []).map((o, i) => ({
              id: `o${i}`,
              name: o.name,
              color: 'blue',
            })),
          }),
        )
        return json(fields[0], 201)
      },
    })
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'New field' }))
    await user.type(screen.getByLabelText('Name'), 'Customer tier')
    await pick(user, screen.getByLabelText('Field type'), 'Dropdown')
    await user.click(screen.getByRole('button', { name: 'Add option' }))
    await user.type(screen.getByLabelText('Option 1 name'), 'Enterprise')
    await user.click(screen.getByRole('button', { name: 'Create field' }))

    const row = (await screen.findByText('Customer tier')).closest('li')!
    expect(within(row).getByText('Enterprise')).toBeVisible()
    const post = stub.calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      name: 'Customer tier',
      type: 'DROPDOWN',
      options: [{ name: 'Enterprise' }],
    })
    expect(post.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('FIELD-1: a name already used on the branch is reported under Name and the draft is kept', async () => {
    installFetch({
      'GET /api/v1/locations/:id/fields': { locationId: 'S', canEdit: true, fields: [] },
      'POST /api/v1/locations/:id/fields': problem(409, 'field.name_taken', 'taken'),
    })
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'New field' }))
    await user.type(screen.getByLabelText('Name'), 'Customer tier')
    await user.click(screen.getByRole('button', { name: 'Create field' }))

    expect(await screen.findByText("'Customer tier' is already used on this branch.")).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('Customer tier')
  })

  it('retiring asks once and says values are kept', async () => {
    const fields: Field[] = [own('Notes')]
    const stub = installFetch({
      'GET /api/v1/locations/:id/fields': () => json({ locationId: 'L', canEdit: true, fields }),
      'DELETE /api/v1/fields/:id': () => {
        fields.length = 0
        return new Response(null, { status: 204 })
      },
    })
    const user = userEvent.setup()
    open(list)

    await user.click(await screen.findByRole('button', { name: 'Retire Notes' }))
    expect(screen.getByText(/Saved values are kept\./)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retire field' }))

    await screen.findByText(/No fields here yet/)
    const del = stub.calls.find((c) => c.method === 'DELETE')!
    expect(del.headers.get('If-Match')).toBe('"1"')
  })

  it('a user who cannot edit gets a read-only view with a note', async () => {
    installFetch({
      'GET /api/v1/locations/:id/fields': {
        locationId: 'L',
        canEdit: false,
        fields: [points(), own('Notes')],
      },
    })
    open(list)

    expect(
      await screen.findByText('Only members who can edit Platform can change its fields.'),
    ).toBeVisible()
    expect(screen.getByText('Notes')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'New field' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Hide / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })

  it('the type of an existing field cannot change', async () => {
    installFetch({
      'GET /api/v1/locations/:id/fields': {
        locationId: 'L',
        canEdit: true,
        fields: [own('Notes')],
      },
    })
    const user = userEvent.setup()
    open(list)

    await user.click(await screen.findByRole('button', { name: 'Edit Notes' }))
    expect(screen.getByLabelText('Field type')).toBeDisabled()
    expect(screen.getByText("The type can't change after creation.")).toBeVisible()
  })
})
