import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { FieldView, ViewFilter } from '../../api/types'
import { FilterGroup } from './FilterBuilder'
import { customFields, customFieldIds } from './testSupport'

const fields: FieldView[] = [
  ...customFields,
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Done',
    type: 'CHECKBOX' as const,
    config: {},
    options: [],
    definedAt: 's1',
    definedAtName: 'Engineering',
    inherited: true,
    hidden: false,
    version: 1,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Due',
    type: 'DATE' as const,
    config: {},
    options: [],
    definedAt: 's1',
    definedAtName: 'Engineering',
    inherited: true,
    hidden: false,
    version: 1,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Notes',
    type: 'TEXT' as const,
    config: {},
    options: [],
    definedAt: 's1',
    definedAtName: 'Engineering',
    inherited: true,
    hidden: false,
    version: 1,
  },
]

function Harness({ onFilter }: { onFilter: (f: ViewFilter) => void }) {
  const [node, setNode] = useState<ViewFilter>({
    op: 'AND',
    items: [{ field: 'priority', op: 'any_of', value: ['URGENT'] }],
  })
  return (
    <FilterGroup
      node={node}
      depth={1}
      options={{ statuses: [], members: [], fields }}
      onChange={(next) => {
        setNode(next)
        onFilter(next)
      }}
    />
  )
}

async function pickField(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.selectOptions(screen.getByLabelText('Filter field'), label)
}

describe('FilterBuilder custom fields (FIELD-3, 3A S5)', () => {
  it('lists the custom fields in their own group of the field picker', () => {
    render(<Harness onFilter={() => {}} />)
    const picker = screen.getByLabelText('Filter field')
    expect(picker.querySelector('optgroup')?.getAttribute('label')).toBe('Custom fields')
    expect(screen.getByRole('option', { name: 'Customer tier' })).toBeInTheDocument()
  })

  it('Dropdown: operators of the type and a checkbox per Option, sent as ids', async () => {
    let last: ViewFilter = {}
    const user = userEvent.setup()
    render(<Harness onFilter={(f) => (last = f)} />)
    await pickField(user, 'Customer tier')

    const ops = Array.from(
      (screen.getByLabelText('Filter operator') as HTMLSelectElement).options,
    ).map((o) => o.value)
    expect(ops).toEqual(['any_of', 'none_of', 'is_set', 'is_empty'])
    await user.click(screen.getByRole('checkbox', { name: 'Enterprise' }))
    expect(last.items![0]).toEqual({
      field: `cf:${customFieldIds.tier}`,
      op: 'any_of',
      value: ['o-free', 'o-ent'],
    })
    await user.selectOptions(screen.getByLabelText('Filter operator'), 'is_empty')
    expect(last.items![0]).toEqual({ field: `cf:${customFieldIds.tier}`, op: 'is_empty' })
    expect(screen.queryByRole('group', { name: 'Filter value' })).not.toBeInTheDocument()
  })

  it('Number: comparison operators and a typed number; between takes two', async () => {
    let last: ViewFilter = {}
    const user = userEvent.setup()
    render(<Harness onFilter={(f) => (last = f)} />)
    await pickField(user, 'Story points')

    const box = screen.getByLabelText('Filter value')
    await user.clear(box)
    await user.type(box, '8')
    expect(last.items![0]).toMatchObject({ op: 'eq', value: 8 })
    await user.selectOptions(screen.getByLabelText('Filter operator'), 'between')
    await user.clear(screen.getByLabelText('Filter value from'))
    await user.type(screen.getByLabelText('Filter value from'), '2')
    await user.clear(screen.getByLabelText('Filter value to'))
    await user.type(screen.getByLabelText('Filter value to'), '9')
    expect(last.items![0]).toMatchObject({ op: 'between', value: [2, 9] })
  })

  it('Checkbox: is checked takes no value; Date: a day or a relative value; Text: contains', async () => {
    let last: ViewFilter = {}
    const user = userEvent.setup()
    render(<Harness onFilter={(f) => (last = f)} />)

    await pickField(user, 'Done')
    expect(last.items![0]).toEqual({
      field: 'cf:33333333-3333-4333-8333-333333333333',
      op: 'is_checked',
    })

    await pickField(user, 'Due')
    await user.selectOptions(screen.getByLabelText('Filter value (relative)'), 'this_week')
    expect(last.items![0]).toMatchObject({ op: 'before', value: 'this_week' })

    await pickField(user, 'Notes')
    const text = screen.getByLabelText('Filter value')
    await user.clear(text)
    await user.type(text, 'urgent')
    expect(last.items![0]).toMatchObject({ op: 'contains', value: 'urgent' })
  })
})
