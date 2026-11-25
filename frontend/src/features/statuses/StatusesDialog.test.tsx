import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { createStatusSim, type SimStatus } from '../../test/statusSim'
import { StatusesDialog, type StatusesLocation } from './StatusesDialog'
import { useLocationStatuses } from './useLocationStatuses'
import { pick } from '../../test/ui'

const st = (id: string, name: string, group: string, color = '#9ca3af'): SimStatus => ({
  id,
  name,
  group,
  color,
})

const spaceSet = () => [
  st('s-todo', 'to do', 'NOT_STARTED'),
  st('s-prog', 'in progress', 'ACTIVE'),
  st('s-done', 'complete', 'DONE'),
  st('s-closed', 'closed', 'CLOSED'),
]

const names: Record<string, string> = { S: 'Marketing', F: 'Q4', L: 'Launch' }

function setup(own: Record<string, SimStatus[]> = { S: spaceSet() }) {
  const sim = createStatusSim({
    parents: { S: null, F: 'S', L: 'S' },
    types: { S: 'SPACE', F: 'FOLDER', L: 'LIST' },
    own,
  })
  const stub = installFetch({
    ...sim.handlers,
    'GET /api/v1/locations/:id': (request) => {
      const id = new URL(request.url).pathname.split('/').pop()!
      return json({ id, name: names[id] })
    },
  })
  return { sim, stub }
}

const space: StatusesLocation = { id: 'S', name: 'Marketing', type: 'SPACE' }
const list: StatusesLocation = { id: 'L', name: 'Launch', type: 'LIST', parentId: 'S' }

function open(location: StatusesLocation) {
  return renderWithProviders(
    <StatusesDialog workspaceId="w1" location={location} onClose={() => {}} />,
  )
}

const nameField = (n: number) => screen.getByRole('textbox', { name: `Status ${n} name` })

describe('StatusesDialog', () => {
  it('FR-22: an inherited set names the Location it comes from and offers to customize', async () => {
    setup()
    open(list)

    expect(await screen.findByText('Inherited from Marketing')).toBeVisible()
    expect(screen.getByText('to do')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Customize for this List' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Reset to inherited' })).not.toBeInTheDocument()
  })

  it('FR-22: a Space says "Defined here"', async () => {
    setup()
    open(space)

    expect(await screen.findByText('Defined here')).toBeVisible()
  })

  it('FR-24: a Space has no "Reset to inherited" action', async () => {
    setup()
    open(space)

    await screen.findByText('Defined here')
    expect(screen.queryByRole('button', { name: 'Reset to inherited' })).not.toBeInTheDocument()
  })

  it('FR-23: saving a Space set refreshes the status choices of its inheriting Lists', async () => {
    const { sim } = setup()
    function Probe() {
      const set = useLocationStatuses('w1', 'L')
      return <p data-testid="probe">{set.data?.statuses?.map((s) => s.name).join(',')}</p>
    }
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <StatusesDialog workspaceId="w1" location={space} onClose={() => {}} />
        <Probe />
      </>,
    )

    await screen.findByText('Defined here')
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('to do,in progress'))
    await user.click(screen.getByRole('button', { name: 'Edit statuses' }))
    const first = nameField(1)
    await user.clear(first)
    await user.type(first, 'Backlog')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('Backlog,in progress'),
    )
    expect(sim.log).toHaveLength(1)
  })

  it('FR-23: a set without a Done or Closed status is refused before sending', async () => {
    const { sim } = setup({ S: [st('a', 'to do', 'NOT_STARTED'), st('b', 'complete', 'DONE')] })
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'Edit statuses' }))
    await pick(user, screen.getByRole('combobox', { name: 'Status 2 group' }), 'Active')

    expect(await screen.findByText('A set needs at least one Done or Closed status.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(sim.log).toHaveLength(0)
  })

  it('FR-23: names must be unique and 1 to 50 characters, colors must be #rrggbb', async () => {
    setup()
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'Edit statuses' }))
    await user.clear(nameField(2))
    await user.type(nameField(2), 'TO DO')
    expect(await screen.findByText('Names must be unique within a set.')).toBeVisible()
    await user.clear(nameField(2))
    expect(await screen.findByText('Enter a name.')).toBeVisible()
    await user.type(nameField(2), 'in progress')
    const color = screen.getByRole('textbox', { name: 'Status 1 color' })
    await user.clear(color)
    await user.type(color, 'red')
    expect(await screen.findByText('Use a color like #3b82f6.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('FR-23: removing an own status asks for a target and sends remap with the target NAME, none for kept ones', async () => {
    const { sim } = setup()
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'Edit statuses' }))
    await user.click(screen.getByRole('button', { name: 'Remove status 2' })) // in progress
    const target = await screen.findByRole('combobox', { name: 'Move tasks from in progress to' })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await pick(user, target, 'to do')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sim.log).toHaveLength(1))
    const body = sim.log[0].body as { statuses: { id?: string; name: string }[]; remap: object[] }
    expect(body.remap).toEqual([{ from: 's-prog', to: 'to do' }])
    expect(body.statuses.map((s) => s.id)).toEqual(['s-todo', 's-done', 's-closed'])
    expect(await screen.findByText('Defined here')).toBeVisible()
  })

  it('FR-23: renaming a kept status and targeting it sends the new name', async () => {
    const { sim } = setup()
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'Edit statuses' }))
    await user.clear(nameField(1))
    await user.type(nameField(1), 'Backlog')
    await user.click(screen.getByRole('button', { name: 'Remove status 2' }))
    await pick(
      user,
      await screen.findByRole('combobox', { name: 'Move tasks from in progress to' }),
      'Backlog',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sim.log).toHaveLength(1))
    expect((sim.log[0].body as { remap: object[] }).remap).toEqual([
      { from: 's-prog', to: 'Backlog' },
    ])
  })

  it('FR-23: the first own set on an inheriting List sends no ids and remaps every inherited status', async () => {
    const { sim } = setup()
    const user = userEvent.setup()
    open(list)

    await user.click(await screen.findByRole('button', { name: 'Customize for this List' }))
    await user.click(screen.getByRole('button', { name: 'Remove status 4' })) // closed
    // three same-name statuses are pre-filled: the user is asked only about "closed"
    const asked = await screen.findAllByRole('combobox', { name: /^Move tasks from/ })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toHaveAccessibleName('Move tasks from closed to')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await pick(user, asked[0], 'complete')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sim.log).toHaveLength(1))
    const body = sim.log[0].body as {
      statuses: { id?: string }[]
      remap: { from: string; to: string }[]
    }
    expect(body.statuses.every((s) => s.id === undefined)).toBe(true)
    expect(body.remap).toEqual([
      { from: 's-todo', to: 'to do' },
      { from: 's-prog', to: 'in progress' },
      { from: 's-done', to: 'complete' },
      { from: 's-closed', to: 'complete' },
    ])
    expect(await screen.findByText('Defined here')).toBeVisible()
    expect(sim.own.L).toHaveLength(3)
  })

  it('FR-23: a server refusal shows its detail and keeps the editor open', async () => {
    setup()
    installFetch({
      'PUT /api/v1/locations/:id/statuses': problem(
        400,
        'status.duplicate_name',
        'Status names must be unique within a set',
      ),
      'GET /api/v1/locations/:id/statuses': json({
        locationId: 'S',
        definedAt: 'S',
        statuses: spaceSet(),
      }),
    })
    const user = userEvent.setup()
    open(space)

    await user.click(await screen.findByRole('button', { name: 'Edit statuses' }))
    await user.type(nameField(1), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Status names must be unique within a set')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('FR-24: reset on a List with three own statuses sends DELETE with three remap entries, asks only for the unmatched one, then shows the inherited set', async () => {
    const { sim } = setup({
      S: spaceSet(),
      L: [
        st('l-todo', 'To Do', 'NOT_STARTED'),
        st('l-done', 'complete', 'DONE'),
        st('l-wip', 'wip', 'ACTIVE'),
      ],
    })
    const user = userEvent.setup()
    open(list)

    expect(await screen.findByText('Defined here')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reset to inherited' }))
    const asked = await screen.findAllByRole('combobox', { name: /^Move tasks from/ })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toHaveAccessibleName('Move tasks from wip to')
    const confirm = screen.getByRole('button', { name: 'Reset to inherited' })
    expect(confirm).toBeDisabled()
    await pick(user, asked[0], 'in progress')
    await user.click(confirm)

    await waitFor(() => expect(sim.log).toHaveLength(1))
    expect(sim.log[0].method).toBe('DELETE')
    expect((sim.log[0].body as { remap: object[] }).remap).toEqual([
      { from: 'l-todo', to: 'to do' },
      { from: 'l-done', to: 'complete' },
      { from: 'l-wip', to: 'in progress' },
    ])
    expect(await screen.findByText('Inherited from Marketing')).toBeVisible()
    expect(within(screen.getByRole('dialog')).getByText('closed')).toBeVisible()
  })
})
