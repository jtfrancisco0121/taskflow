import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FieldView } from '../../api/types'
import { FilterInput } from './FilterInput'

const tier: FieldView = {
  id: 'f-tier',
  name: 'Customer tier',
  type: 'DROPDOWN',
  config: {},
  options: [
    { id: 'o-free', name: 'Free' },
    { id: 'o-pro', name: 'Pro' },
    { id: 'o-ent', name: 'Enterprise' },
  ],
  version: 1,
}

/** A parent that, like the filter builder, stores what the input reports. */
function Parent({ initial, spy }: { initial: unknown; spy: (v: unknown) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <FilterInput
      field={tier}
      op="any_of"
      value={value}
      onChange={(next) => {
        spy(next)
        setValue(next)
      }}
    />
  )
}

describe('ChoiceGroup in FilterInput (CAP-3)', () => {
  it('two quick option checks on a Dropdown both land, in click order', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<Parent initial={[]} spy={spy} />)
    await user.click(screen.getByRole('checkbox', { name: 'Free' }))
    await user.click(screen.getByRole('checkbox', { name: 'Enterprise' }))
    expect(spy).toHaveBeenLastCalledWith(['o-free', 'o-ent'])
    expect(screen.getByRole('checkbox', { name: 'Free' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Enterprise' })).toBeChecked()
  })

  it('a quick check then uncheck of the same option ends at []', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<Parent initial={[]} spy={spy} />)
    await user.click(screen.getByRole('checkbox', { name: 'Pro' }))
    await user.click(screen.getByRole('checkbox', { name: 'Pro' }))
    expect(spy).toHaveBeenNthCalledWith(1, ['o-pro'])
    expect(spy).toHaveBeenLastCalledWith([])
    expect(screen.getByRole('checkbox', { name: 'Pro' })).not.toBeChecked()
  })

  it('unchecking keeps the order of the other values', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    render(<Parent initial={['o-free', 'o-pro', 'o-ent']} spy={spy} />)
    await user.click(screen.getByRole('checkbox', { name: 'Pro' }))
    expect(spy).toHaveBeenLastCalledWith(['o-free', 'o-ent'])
  })

  it('an undefined value followed by two quick clicks lands both, even when the parent re-renders between them', async () => {
    const spy = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <FilterInput field={tier} op="any_of" value={undefined} onChange={spy} />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Free' }))
    // the parent re-renders for another reason before it applies the first value
    rerender(<FilterInput field={tier} op="any_of" value={undefined} onChange={spy} />)
    await user.click(screen.getByRole('checkbox', { name: 'Pro' }))
    expect(spy).toHaveBeenLastCalledWith(['o-free', 'o-pro'])
  })
})
