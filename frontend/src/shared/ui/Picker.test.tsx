import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { pick } from '../../test/ui'
import { Picker } from './Picker'

const ITEMS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Tomorrow', hint: 'Fri' },
]

function Harness({ mode, onPick }: { mode: 'single' | 'multi'; onPick?: (v: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <Picker
      trigger={<button type="button">Choose</button>}
      label="Choose one"
      mode={mode}
      items={ITEMS}
      selected={selected}
      onPick={(value) => {
        onPick?.(value)
        setSelected((cur) =>
          mode === 'single'
            ? [value]
            : cur.includes(value)
              ? cur.filter((v) => v !== value)
              : [...cur, value],
        )
      }}
    />
  )
}

describe('Picker', () => {
  it('opens a floating popover with the search field focused and filters as you type', async () => {
    const user = userEvent.setup()
    render(<Harness mode="single" />)
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    const panel = await screen.findByRole('dialog', { name: 'Choose one' })
    expect(panel).toHaveAttribute('data-tf-floating')
    const search = screen.getByRole('combobox', { name: 'Choose one' })
    expect(search).toHaveFocus()
    await user.type(search, 'bet')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByText('No match')).toBeInTheDocument()
  })

  it('single mode: arrow + Enter picks, closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness mode="single" onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Choose' })
    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await vi.waitFor(() => expect(trigger).toHaveFocus())
  })

  it('multi mode: stays open, toggles, and two pick() calls in a row both land', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness mode="multi" onPick={onPick} />)
    const trigger = screen.getByRole('button', { name: 'Choose' })
    await pick(user, trigger, 'Alpha')
    await pick(user, trigger, 'Beta')
    expect(onPick.mock.calls).toEqual([['a'], ['b']])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    await pick(user, trigger, 'Alpha')
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'false')
  })

  it('names an item by its label even when it shows a hint', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness mode="single" onPick={onPick} />)
    await pick(user, screen.getByRole('button', { name: 'Choose' }), 'Tomorrow')
    expect(onPick).toHaveBeenCalledWith('c')
  })
})
