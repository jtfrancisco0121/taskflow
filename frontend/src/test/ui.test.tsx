import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Select } from '../shared/ui/Select'
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
    // The placeholder is not an option a user can pick (AD-11).
    expect(await optionsOf(user, control)).toEqual(['Assign to', 'Change status'])
    expect(await findOption(user, control, 'Change status')).toBe('Change status')
  })

  it('leaves out disabled options in optionsOf and in { index }', async () => {
    const user = userEvent.setup()
    render(
      <>
        <label htmlFor="d">Letter</label>
        <select id="d" defaultValue="">
          <option value="">Choose</option>
          <option value="a">A</option>
          <option value="b" disabled>
            B
          </option>
          <option value="c">C</option>
        </select>
      </>,
    )
    const control = screen.getByLabelText('Letter')
    expect(await optionsOf(user, control)).toEqual(['A', 'C'])
    await pick(user, control, { index: 1 })
    expectValue(control, 'C')
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

// The Radix path against the real library Select (slice-1 carry-over 5), next to the fixtures above.
describe('library Select (real Radix)', () => {
  function Harness({
    options,
    placeholder,
    initial = '',
  }: {
    options: { value: string; label: string; disabled?: boolean }[]
    placeholder?: string
    initial?: string
  }) {
    const [value, setValue] = useState(initial)
    return (
      <>
        <label htmlFor="lib">Letter</label>
        <Select
          id="lib"
          value={value}
          onValueChange={setValue}
          options={options}
          placeholder={placeholder}
        />
        <output data-testid="stored">{value}</output>
      </>
    )
  }
  const AB = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]

  it('picks, reads, lists and finds options', async () => {
    const user = userEvent.setup()
    render(<Harness options={AB} placeholder="Choose" />)
    const control = screen.getByLabelText('Letter')
    expectValue(control, 'Choose')
    expect(await optionsOf(user, control)).toEqual(['A', 'B'])
    await pick(user, control, 'B')
    expectValue(control, 'B')
    expect(screen.getByTestId('stored')).toHaveTextContent('b')
    await pick(user, control, { index: 0 })
    expectValue(control, 'A')
    expect(await findOption(user, control, 'B')).toBe('B')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('parity: a native select with a placeholder and the library Select give the same options and the same index pick', async () => {
    const user = userEvent.setup()
    render(
      <>
        <label htmlFor="n">Native</label>
        <select id="n" defaultValue="">
          <option value="">Choose</option>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <Harness options={AB} placeholder="Choose" />
      </>,
    )
    const native = screen.getByLabelText('Native')
    const library = screen.getByLabelText('Letter')
    expect(await optionsOf(user, native)).toEqual(['A', 'B'])
    expect(await optionsOf(user, library)).toEqual(['A', 'B'])
    await pick(user, native, { index: 0 })
    await pick(user, library, { index: 0 })
    expectValue(native, 'A')
    expectValue(library, 'A')
  })

  it('lists a real empty choice (a sentinel item) and can pick it by index', async () => {
    const user = userEvent.setup()
    render(
      <Harness options={[{ value: '', label: 'Any' }, ...AB]} placeholder="Choose" initial="a" />,
    )
    const control = screen.getByLabelText('Letter')
    expect(await optionsOf(user, control)).toEqual(['Any', 'A', 'B'])
    await pick(user, control, { index: 0 })
    expectValue(control, 'Any')
    expect(screen.getByTestId('stored')).toBeEmptyDOMElement()
  })

  it('leaves out disabled items', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        options={[AB[0], { value: 'x', label: 'X', disabled: true }, AB[1]]}
        placeholder="Choose"
      />,
    )
    const control = screen.getByLabelText('Letter')
    expect(await optionsOf(user, control)).toEqual(['A', 'B'])
    await pick(user, control, { index: 1 })
    expectValue(control, 'B')
  })

  it('close() waits only for the popup its own open() returned', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Harness options={AB} placeholder="Choose" />
        {/* another popup that stays open for the whole test */}
        <div role="listbox" aria-label="Unrelated">
          <div role="option">Stays</div>
        </div>
      </>,
    )
    // Before the fix, close() waited for no listbox at all on the page and timed out here.
    expect(await optionsOf(user, screen.getByLabelText('Letter'))).toEqual(['A', 'B'])
    await waitFor(() => expect(screen.getAllByRole('listbox')).toHaveLength(1))
    expect(screen.getByRole('listbox', { name: 'Unrelated' })).toBeInTheDocument()
  })
})
