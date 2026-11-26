import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ViewConfig } from '../../api/types'
import { installFetch, renderWithProviders } from '../../test/api'
import { pick } from '../../test/ui'
import { ChipBar } from './ChipBar'
import { describeCondition } from './describeCondition'
import { baseRoutes, scope } from './testSupport'
import type { UrlState } from './urlState'

const options = {
  statuses: [{ value: 's1', label: 'To do' }],
  members: [
    { value: 'u1', label: 'Maya Lopez' },
    { value: 'u2', label: 'Omar Haddad' },
  ],
}

describe('describeCondition (the chip voice)', () => {
  it('reads priority, assignee, valueless and unknown conditions', () => {
    expect(describeCondition({ field: 'priority', op: 'any_of', value: ['URGENT'] }, options)).toBe(
      'Priority is any of Urgent',
    )
    expect(
      describeCondition({ field: 'assignee', op: 'any_of', value: ['u1', 'u2', 'me'] }, options),
    ).toBe('Assignee is any of 3 people')
    expect(describeCondition({ field: 'dueDate', op: 'overdue' }, options)).toBe(
      'Due date is overdue',
    )
    expect(describeCondition({ field: 'cf:gone', op: 'is_set' }, options)).toBe('Unknown field')
  })
})

function Harness({
  initial,
  onUpdate,
}: {
  initial: ViewConfig
  onUpdate?: (patch: Partial<UrlState>) => void
}) {
  const [config, setConfig] = useState(initial)
  return (
    <ChipBar
      scope={scope}
      config={config}
      update={(patch) => {
        onUpdate?.(patch)
        setConfig((c) => ({
          ...c,
          ...(patch.f ? { filter: patch.f } : {}),
          ...(patch.g ? { group: patch.g } : {}),
          ...(patch.s ? { sort: patch.s } : {}),
        }))
      }}
    />
  )
}

const filter = {
  op: 'AND',
  items: [
    { field: 'priority', op: 'any_of', value: ['URGENT'] },
    {
      op: 'OR',
      items: [
        { field: 'title', op: 'contains', value: 'bug' },
        { field: 'status', op: 'any_of', value: ['s1'] },
      ],
    },
  ],
}

describe('CAP-3 chip bar', () => {
  it('shows one chip per top-level condition, a group chip, and "Filter (n)"', async () => {
    installFetch(baseRoutes)
    renderWithProviders(<Harness initial={{ v: 1, filter }} />)
    expect(screen.getByRole('button', { name: 'Filter (3)' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Priority is any of Urgent' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Any of 2 conditions' })).toBeVisible()
    expect(screen.queryByLabelText('Filter field')).not.toBeInTheDocument()
  })

  it('counts a leaf filter root as one chip', () => {
    installFetch(baseRoutes)
    renderWithProviders(
      <Harness initial={{ v: 1, filter: { field: 'priority', op: 'any_of', value: ['LOW'] } }} />,
    )
    expect(screen.getByRole('button', { name: 'Priority is any of Low' })).toBeVisible()
  })

  it('the x removes that chip through update() and keeps the others', async () => {
    installFetch(baseRoutes)
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ v: 1, filter }} onUpdate={onUpdate} />)
    await user.click(screen.getByRole('button', { name: 'Remove Priority is any of Urgent' }))
    expect(onUpdate).toHaveBeenCalledWith({ f: { op: 'AND', items: [filter.items[1]] } })
    expect(screen.queryByRole('button', { name: 'Priority is any of Urgent' })).toBeNull()
  })

  it('a chip opens the panel on its condition; Escape closes it and focus returns to Filter', async () => {
    installFetch(baseRoutes)
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ v: 1, filter }} />)
    await user.click(screen.getByRole('button', { name: 'Priority is any of Urgent' }))
    const fields = await screen.findAllByLabelText('Filter field')
    await waitFor(() => expect(fields[0]).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryAllByLabelText('Filter field')).toHaveLength(0))
    expect(screen.getByRole('button', { name: 'Filter (3)' })).toHaveFocus()
  })

  it('group and sort chips reset to none and manual ascending', async () => {
    installFetch(baseRoutes)
    const onUpdate = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Harness
        initial={{ v: 1, group: 'status', sort: [{ key: 'title', dir: 'desc' }] }}
        onUpdate={onUpdate}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove grouping' }))
    expect(onUpdate).toHaveBeenCalledWith({ g: 'none' })
    await user.click(screen.getByRole('button', { name: 'Remove sorting' }))
    expect(onUpdate).toHaveBeenCalledWith({ s: [{ key: 'manual', dir: 'asc' }] })
    await pick(user, screen.getByLabelText('Group by'), 'Priority')
    expect(onUpdate).toHaveBeenCalledWith({ g: 'priority' })
  })
})
