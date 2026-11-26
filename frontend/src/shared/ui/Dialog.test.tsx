import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'

function Harness({ size, closeOnEscape }: { size?: 'task'; closeOnEscape?: () => boolean }) {
  const [open, setOpen] = useState(true)
  const ref = createRef<HTMLInputElement>()
  if (!open) return <p>closed</p>
  return (
    <Dialog
      title="Task ACME-1"
      size={size}
      initialFocus={size ? ref : undefined}
      closeOnEscape={closeOnEscape}
      onClose={() => setOpen(false)}
    >
      <button type="button">First</button>
      <input ref={ref} aria-label="Title" />
    </Dialog>
  )
}

describe('Dialog', () => {
  it('focuses the first focusable element and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('size="task" is a modal dialog named by its title, 940px at most, and initialFocus wins', () => {
    render(<Harness size="task" />)
    const dialog = screen.getByRole('dialog', { name: 'Task ACME-1' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.className).toContain('max-w-[940px]')
    expect(screen.getByRole('heading', { name: 'Task ACME-1' })).toHaveClass('sr-only')
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus()
  })

  it('closeOnEscape returning false leaves the dialog open and the Escape unstopped', async () => {
    const user = userEvent.setup()
    let seen = false
    render(<Harness closeOnEscape={() => false} />)
    document.addEventListener('keydown', () => (seen = true), { once: true })
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(seen).toBe(true)
  })

  it('closeOnEscape returning true still closes', async () => {
    const user = userEvent.setup()
    render(<Harness closeOnEscape={() => true} />)
    await user.keyboard('{Escape}')
    expect(screen.getByText('closed')).toBeInTheDocument()
  })
})
