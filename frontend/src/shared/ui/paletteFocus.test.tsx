import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'
import { DropdownMenu } from './DropdownMenu'
import { Popover } from './Popover'
import { Select } from './Select'

/**
 * AD-5 (ClickUp 14yq6g33461): Radix gives focus back to a closed layer's trigger a task after the layer is gone.
 * A Ctrl/Cmd+K pressed in that gap opens the Command palette first; the late return must not take the focus out
 * of the palette's search field.
 */
function Harness({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState(false)
  return (
    <>
      {children}
      {/* Ctrl/Cmd+K stand-in: a click event (not a pointer press) leaves the focus where it is. */}
      <button type="button" hidden data-testid="open-palette" onClick={() => setPalette(true)} />
      {palette && (
        <Dialog title="Command palette" placement="top" onClose={() => setPalette(false)}>
          <input aria-label="Search commands and tasks" />
        </Dialog>
      )}
    </>
  )
}

/** Lets the timers Radix schedules on close (the focus return) run. */
const flushTimers = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

async function escapeThenOpenPalette(layer: HTMLElement) {
  fireEvent.keyDown(layer, { key: 'Escape' })
  fireEvent.click(screen.getByTestId('open-palette'))
  const field = screen.getByRole('textbox', { name: 'Search commands and tasks' })
  expect(field).toHaveFocus()
  await flushTimers()
  return field
}

/** Closes the palette with Escape: focus goes back to a real element (the closed layer's trigger), never the body. */
function closePalette(field: HTMLElement) {
  fireEvent.keyDown(field, { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: 'Search commands and tasks' })).toBeNull()
}

describe('a layer closing right before the palette opens (AD-5)', () => {
  it('a Select gives its focus back late without taking it from the palette, and gets it when the palette closes', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <label htmlFor="s">Sort by</label>
        <Select
          id="s"
          value=""
          onValueChange={() => {}}
          options={[{ value: 'a', label: 'Alpha' }]}
          placeholder="Choose"
        />
      </Harness>,
    )
    const trigger = screen.getByLabelText('Sort by')
    await user.click(trigger)
    const field = await escapeThenOpenPalette(await screen.findByRole('listbox'))
    expect(field).toHaveFocus()
    closePalette(field)
    expect(trigger).toHaveFocus()
  })

  it('a menu gives its focus back late without taking it from the palette, and gets it when the palette closes', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <DropdownMenu
          label="Workspace switcher"
          trigger={<button type="button">Workspace switcher</button>}
          items={[{ label: 'Settings', onSelect: () => {} }]}
        />
      </Harness>,
    )
    const trigger = screen.getByRole('button', { name: 'Workspace switcher' })
    await user.click(trigger)
    const field = await escapeThenOpenPalette(await screen.findByRole('menu'))
    expect(field).toHaveFocus()
    closePalette(field)
    expect(trigger).toHaveFocus()
  })

  it('a popover gives its focus back late without taking it from the palette, and gets it when the palette closes', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <Popover label="Filters" trigger={<button type="button">Filters</button>}>
          <button type="button">Clear</button>
        </Popover>
      </Harness>,
    )
    const trigger = screen.getByRole('button', { name: 'Filters' })
    await user.click(trigger)
    const field = await escapeThenOpenPalette(
      await screen.findByRole('dialog', { name: 'Filters' }),
    )
    expect(field).toHaveFocus()
    closePalette(field)
    expect(trigger).toHaveFocus()
  })

  it('without a palette, the closed Select still gives focus back to its trigger', async () => {
    const user = userEvent.setup()
    render(
      <Harness>
        <label htmlFor="s">Sort by</label>
        <Select
          id="s"
          value=""
          onValueChange={() => {}}
          options={[{ value: 'a', label: 'Alpha' }]}
          placeholder="Choose"
        />
      </Harness>,
    )
    const trigger = screen.getByLabelText('Sort by')
    await user.click(trigger)
    fireEvent.keyDown(await screen.findByRole('listbox'), { key: 'Escape' })
    await flushTimers()
    expect(trigger).toHaveFocus()
  })
})
