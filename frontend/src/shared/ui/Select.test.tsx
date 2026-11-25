import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'
import { Select, type SelectProps } from './Select'
import { expectValue, optionsOf, pick } from '../../test/ui'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

function Harness(props: Partial<SelectProps> & { initial?: string }) {
  const { initial = '', ...rest } = props
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="s">Letter</label>
      <Select id="s" value={value} onValueChange={setValue} options={OPTIONS} {...rest} />
      <output data-testid="stored">{value}</output>
    </>
  )
}

describe('Select', () => {
  it('shows the placeholder on the trigger and never lists it as an item', async () => {
    const user = userEvent.setup()
    render(<Harness placeholder="Choose a letter" />)
    const trigger = screen.getByLabelText('Letter')
    expect(trigger).toHaveTextContent('Choose a letter')
    expect(await optionsOf(user, trigger)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('picks by label, shows the label and keeps the caller value', async () => {
    const user = userEvent.setup()
    render(<Harness placeholder="Choose a letter" />)
    const trigger = screen.getByLabelText('Letter')
    await pick(user, trigger, 'Beta')
    expectValue(trigger, 'Beta')
    expect(screen.getByTestId('stored')).toHaveTextContent('b')
  })

  it('maps a real empty choice to and from the sentinel', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        initial="a"
        options={[{ value: '', label: 'Any letter' }, ...OPTIONS]}
        placeholder="Choose"
      />,
    )
    const trigger = screen.getByLabelText('Letter')
    expectValue(trigger, 'Alpha')
    expect(await optionsOf(user, trigger)).toEqual(['Any letter', 'Alpha', 'Beta', 'Gamma'])
    await pick(user, trigger, 'Any letter')
    expect(screen.getByTestId('stored')).toBeEmptyDOMElement()
    expectValue(trigger, 'Any letter')
  })

  it('shows the placeholder for a value that matches no option and leaves the stored value alone', () => {
    render(<Harness initial="zzz" placeholder="—" />)
    expect(screen.getByLabelText('Letter')).toHaveTextContent('—')
    expect(screen.getByTestId('stored')).toHaveTextContent('zzz')
  })

  it('supports groups and aria-label', async () => {
    const user = userEvent.setup()
    render(
      <Select
        aria-label="Grouped"
        value=""
        onValueChange={() => {}}
        groups={[{ label: 'First', options: [{ value: 'x', label: 'Ex' }] }]}
        placeholder="Pick"
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Grouped' })
    expect(await optionsOf(user, trigger)).toEqual(['Ex'])
  })

  it('can be opened and picked with the keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness placeholder="Choose" />)
    screen.getByLabelText('Letter').focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByTestId('stored')).toHaveTextContent('b'))
  })

  it('forwards autoFocus to the trigger', () => {
    render(<Harness autoFocus />)
    expect(screen.getByLabelText('Letter')).toHaveFocus()
  })

  it('does not report clicks or keys to its React ancestors (AD-12)', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onClick={onClick} onKeyDown={onKeyDown}>
        <Harness placeholder="Choose" />
      </div>,
    )
    const trigger = screen.getByLabelText('Letter')
    await user.click(trigger)
    const option = await screen.findByRole('option', { name: 'Alpha' })
    await user.click(option)
    expect(screen.getByTestId('stored')).toHaveTextContent('a')
    await user.click(trigger)
    await screen.findByRole('option', { name: 'Beta' })
    await user.keyboard('{ArrowDown}{Enter}')
    await user.click(trigger)
    await screen.findByRole('option', { name: 'Beta' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onClick).not.toHaveBeenCalled()
    // The keyboard handler runs only for the trigger itself (focus is on it), never for the listbox.
    const keysFromList = onKeyDown.mock.calls.filter(([e]) =>
      (e.target as HTMLElement).closest('[role="listbox"]'),
    )
    expect(keysFromList).toEqual([])
  })
})

describe('Select inside a Dialog (AD-12)', () => {
  it('closes the Select on the first Escape and the Dialog on the second, with focus returning each time', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Dialog title="Edit" onClose={onClose}>
        <label htmlFor="s">Letter</label>
        <Select id="s" value="" onValueChange={() => {}} options={OPTIONS} placeholder="Choose" />
      </Dialog>,
    )
    const trigger = screen.getByLabelText('Letter')
    await user.click(trigger)
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close the Dialog when an item is picked, and renders above it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Dialog title="Edit" onClose={onClose}>
        <Select aria-label="Letter" value="" onValueChange={() => {}} options={OPTIONS} />
      </Dialog>,
    )
    await user.click(screen.getByLabelText('Letter'))
    const listbox = await screen.findByRole('listbox')
    expect(listbox.closest('[data-tf-floating]')).toHaveClass('z-(--tf-z-floating)')
    await user.click(await screen.findByRole('option', { name: 'Beta' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the hidden form select out of the Tab trap', async () => {
    const user = userEvent.setup()
    render(
      <Dialog title="Edit" onClose={() => {}}>
        <form>
          <input aria-label="First" />
          <Select
            aria-label="Letter"
            value=""
            onValueChange={() => {}}
            options={OPTIONS}
            name="letter"
          />
          <button type="button">Last</button>
        </form>
      </Dialog>,
    )
    expect(document.querySelector('select[aria-hidden="true"]')).not.toBeNull()
    screen.getByRole('button', { name: 'Last' }).focus()
    await user.tab()
    expect(screen.getByLabelText('First')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })
})
