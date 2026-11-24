import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FieldView } from '../../api/types'
import { installFetch, renderWithProviders } from '../../test/api'
import { ValueCell } from './ValueCell'
import { ValueEditor } from './ValueEditor'
import { FilterInput } from './FilterInput'

const reviewer: FieldView = {
  id: 'f-reviewer',
  name: 'Reviewer',
  type: 'PEOPLE',
  config: {},
  options: [],
  version: 1,
}

const members = {
  items: [
    { userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' },
    { userId: 'u2', displayName: 'Omar Haddad', role: 'MEMBER' },
  ],
}

describe('People field (3A S8)', () => {
  it('the cell shows an avatar per member and a "Former member" chip for a user who left', async () => {
    installFetch({ 'GET /api/v1/workspaces/:id/members': members })
    renderWithProviders(<ValueCell field={reviewer} value={['u1', 'gone']} workspaceId="w1" />)

    expect(await screen.findByLabelText('Maya Lopez')).toHaveTextContent('ML')
    expect(await screen.findByText('Former member')).toBeVisible()
  })

  it('an empty People value is "—" with the accessible name "empty"', () => {
    installFetch({ 'GET /api/v1/workspaces/:id/members': members })
    renderWithProviders(<ValueCell field={reviewer} value={[]} workspaceId="w1" />)
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('the editor picks members, commits their ids and clears with null', async () => {
    installFetch({ 'GET /api/v1/workspaces/:id/members': members })
    const onCommit = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ValueEditor
        field={reviewer}
        value={['u1']}
        label="Reviewer for ACME-1"
        workspaceId="w1"
        onCommit={onCommit}
      />,
    )

    await user.click(await screen.findByRole('checkbox', { name: 'Omar Haddad' }))
    expect(onCommit).toHaveBeenLastCalledWith(['u1', 'u2'])
    await user.click(screen.getByRole('checkbox', { name: 'Maya Lopez' }))
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('a former member shows as a checked "Former member" row that can be removed', async () => {
    installFetch({ 'GET /api/v1/workspaces/:id/members': members })
    const onCommit = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <ValueEditor
        field={reviewer}
        value={['u1', 'gone']}
        label="Reviewer"
        workspaceId="w1"
        onCommit={onCommit}
      />,
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Former member' }))
    expect(onCommit).toHaveBeenLastCalledWith(['u1'])
  })

  it('the filter offers Me and the members', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <FilterInput
        field={reviewer}
        op="any_of"
        value={['me']}
        onChange={onChange}
        people={[
          { value: 'me', label: 'Me' },
          { value: 'u2', label: 'Omar Haddad' },
        ]}
      />,
    )
    expect(screen.getByRole('checkbox', { name: 'Me' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Omar Haddad' }))
    expect(onChange).toHaveBeenLastCalledWith(['me', 'u2'])
  })
})
