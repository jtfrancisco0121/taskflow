import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Popover } from './Popover'

describe('Popover', () => {
  it('opens on click, holds its content and closes on Escape with focus back on the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger={<Button>Due date</Button>} label="Due date picker">
        <button type="button">Today</button>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Due date' })
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Due date picker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('does not report clicks or keys from its content to its React ancestors (AD-12)', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    render(
      <div onClick={onClick} onKeyDown={onKeyDown}>
        <Popover trigger={<Button>Open</Button>} label="Panel">
          <button type="button">Inside</button>
        </Popover>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('button', { name: 'Inside' }))
    await user.keyboard('{Enter}{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const fromPanel = [...onClick.mock.calls, ...onKeyDown.mock.calls].filter(([e]) =>
      (e.target as HTMLElement).closest('[data-tf-floating]'),
    )
    expect(fromPanel).toEqual([])
  })
})
