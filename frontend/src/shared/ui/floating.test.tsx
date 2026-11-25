import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { DropdownMenu } from './DropdownMenu'
import { hasOpenFloatingLayer } from './floating'
import { Popover } from './Popover'
import { Select } from './Select'
import { Tooltip } from './Tooltip'

describe('hasOpenFloatingLayer', () => {
  it('is false with nothing open', () => {
    render(<Button>Plain</Button>)
    expect(hasOpenFloatingLayer()).toBe(false)
  })

  it('is true with an open DropdownMenu', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu trigger={<Button>Menu</Button>} items={[{ label: 'A', onSelect: () => {} }]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    await screen.findByRole('menu')
    expect(hasOpenFloatingLayer()).toBe(true)
  })

  it('is true with an open Popover and false again once it closes', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button>Pop</Button>} label="Example">
        <p>hello</p>
      </Popover>,
    )
    await user.click(screen.getByRole('button', { name: 'Pop' }))
    await screen.findByRole('dialog', { name: 'Example' })
    expect(hasOpenFloatingLayer()).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(hasOpenFloatingLayer()).toBe(false))
  })

  it('is true with an open Select', async () => {
    const user = userEvent.setup()
    render(
      <Select
        aria-label="Status"
        value="a"
        onValueChange={() => {}}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await screen.findByRole('listbox')
    expect(hasOpenFloatingLayer()).toBe(true)
  })

  it('is false with only a shown Tooltip', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip label="Hint" delayDuration={0}>
        <Button>Target</Button>
      </Tooltip>,
    )
    await user.hover(screen.getByRole('button', { name: 'Target' }))
    await screen.findByRole('tooltip')
    expect(hasOpenFloatingLayer()).toBe(false)
  })

  it('is false with only the palette panel (Dialog placement top)', () => {
    render(
      <Dialog title="Command palette" placement="top" onClose={() => {}}>
        <input aria-label="Search" />
      </Dialog>,
    )
    const panel = screen.getByRole('dialog', { name: 'Command palette' })
    expect(panel).toHaveAttribute('data-tf-floating')
    expect(panel).toHaveAttribute('data-tf-palette')
    expect(hasOpenFloatingLayer()).toBe(false)
  })
})
