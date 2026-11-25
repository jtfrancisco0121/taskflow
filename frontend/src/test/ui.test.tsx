import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { expectValue, findOption, open, optionsOf, pick, valueOf } from './ui'

// Fixtures only. They prove the helper on a native <select> and on an ARIA combobox shaped like
// Radix Select (a trigger, a portalled listbox wired by aria-controls that exists only while open).

const ITEMS: [string, string][] = [
  ['ASSIGN', 'Assign to'],
  ['CHANGE_STATUS', 'Change status'],
]

function Native() {
  return (
    <>
      <label htmlFor="n">Action type</label>
      <select id="n" defaultValue="">
        <option value="">Choose an action</option>
        {ITEMS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </>
  )
}

function Combobox() {
  const [shown, setShown] = useState('Choose an action')
  const [isOpen, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        role="combobox"
        aria-label="Action type"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'popup' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {shown}
      </button>
      {isOpen &&
        createPortal(
          <div id="popup" role="listbox">
            {ITEMS.map(([value, label]) => (
              <div
                key={value}
                role="option"
                aria-selected={shown === label}
                onClick={() => {
                  setShown(label)
                  setOpen(false)
                }}
              >
                {label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

describe('native select', () => {
  it('picks by label and by index, reads, lists and finds options', async () => {
    const user = userEvent.setup()
    render(<Native />)
    const control = screen.getByLabelText('Action type')
    expectValue(control, 'Choose an action')
    await pick(user, control, 'Assign to')
    expectValue(control, 'Assign to')
    expect(valueOf(control)).toBe('Assign to')
    await pick(user, control, { index: 1 })
    expectValue(control, 'Change status')
    await pick(user, control, { index: 0 })
    expectValue(control, 'Assign to')
    expect(await optionsOf(user, control)).toEqual([
      'Choose an action',
      'Assign to',
      'Change status',
    ])
    expect(await findOption(user, control, 'Change status')).toBe('Change status')
  })

  it('a value instead of a label throws', async () => {
    const user = userEvent.setup()
    render(<Native />)
    await expect(pick(user, screen.getByLabelText('Action type'), 'ASSIGN')).rejects.toThrow(
      'no option labelled "ASSIGN"',
    )
  })

  it('an index past the real options throws', async () => {
    const user = userEvent.setup()
    render(<Native />)
    await expect(pick(user, screen.getByLabelText('Action type'), { index: 2 })).rejects.toThrow()
  })
})

describe('combobox trigger', () => {
  it('opens, picks by label and by index, reads, lists and finds options', async () => {
    const user = userEvent.setup()
    render(<Combobox />)
    const control = screen.getByRole('combobox', { name: 'Action type' })
    expectValue(control, 'Choose an action')

    const popup = await open(user, control)
    expect(popup).toHaveAttribute('role', 'listbox')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await pick(user, control, 'Change status')
    expectValue(control, 'Change status')
    await pick(user, control, { index: 0 })
    expectValue(control, 'Assign to')
    expect(await optionsOf(user, control)).toEqual(['Assign to', 'Change status'])
    expect(await findOption(user, control, 'Change status')).toBe('Change status')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a value instead of a label throws', async () => {
    const user = userEvent.setup()
    render(<Combobox />)
    await expect(
      pick(user, screen.getByRole('combobox', { name: 'Action type' }), 'ASSIGN'),
    ).rejects.toThrow()
  })
})
