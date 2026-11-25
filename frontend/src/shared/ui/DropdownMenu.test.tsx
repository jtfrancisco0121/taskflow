import { render, screen, waitFor } from '@testing-library/react'
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
})
