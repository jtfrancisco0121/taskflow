import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { DropdownMenu } from './DropdownMenu'

function setup() {
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const onClick = vi.fn()
  const onKeyDown = vi.fn()
  render(
    <div onClick={onClick} onKeyDown={onKeyDown}>
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[
          { label: 'Rename', onSelect: onRename, shortcut: 'F2' },
          'separator',
          { label: 'Delete', onSelect: onDelete, destructive: true },
          { label: 'Archive', onSelect: () => {}, disabled: true },
        ]}
      />
    </div>,
  )
  return { onRename, onDelete, onClick, onKeyDown }
}

describe('DropdownMenu', () => {
  it('opens on click, lists its items and runs the picked one', async () => {
    const user = userEvent.setup()
    const { onRename } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(await screen.findAllByRole('menuitem')).toHaveLength(3)
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-danger')
    await user.click(screen.getByRole('menuitem', { name: /Rename/ }))
    expect(onRename).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('works with the keyboard and closes on Escape', async () => {
    const user = userEvent.setup()
    const { onRename } = setup()
    screen.getByRole('button', { name: 'Actions' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    await user.keyboard('{Enter}')
    expect(onRename).toHaveBeenCalledTimes(1)
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('does not report picks or keys to its React ancestors (AD-12)', async () => {
    const user = userEvent.setup()
    const { onClick, onKeyDown } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await screen.findByRole('menu')
    await user.keyboard('{ArrowDown}{Enter}')
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // Only the trigger's own clicks and keys (focus is on it) reach the host, never anything from the menu.
    const fromMenu = [...onClick.mock.calls, ...onKeyDown.mock.calls].filter(([e]) =>
      (e.target as HTMLElement).closest('[role="menu"]'),
    )
    expect(fromMenu).toEqual([])
  })

  it('renders radio items as menuitemradio with the checked one marked', async () => {
    const user = userEvent.setup()
    const pick = vi.fn()
    render(
      <DropdownMenu
        trigger={<Button>Pick</Button>}
        label="Choices"
        items={[
          { type: 'radio', label: 'Acme', checked: true, onSelect: () => {}, detail: 'Owner' },
          { type: 'radio', label: 'Beta', checked: false, onSelect: pick },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Pick' }))
    expect(await screen.findByRole('menu', { name: 'Choices' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: /Acme/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: /Acme/ })).toHaveTextContent('Owner')
    expect(screen.getByRole('menuitemradio', { name: /Beta/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await user.click(screen.getByRole('menuitemradio', { name: /Beta/ }))
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('can be controlled: open opens it and Escape reports onOpenChange(false)', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    function Host() {
      const [open, setOpen] = useState(true)
      return (
        <DropdownMenu
          trigger={<Button>Actions</Button>}
          open={open}
          onOpenChange={(value) => {
            onOpenChange(value)
            setOpen(value)
          }}
          items={[{ label: 'Rename', onSelect: () => {} }]}
        />
      )
    }
    render(<Host />)
    expect(await screen.findByRole('menu')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('keepOpen leaves the menu open after the pick, others close it', async () => {
    const user = userEvent.setup()
    const more = vi.fn()
    render(
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[
          { label: 'Show more', onSelect: more, keepOpen: true },
          { label: 'Close me', onSelect: () => {} },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Show more' }))
    expect(more).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('menu')).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: 'Close me' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})
