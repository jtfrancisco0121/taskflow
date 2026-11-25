import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { Avatar } from './Avatar'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Kbd } from './Kbd'
import { PriorityBadge } from './PriorityBadge'
import { Skeleton } from './Skeleton'
import { StatusBadge } from './StatusBadge'
import { Textarea } from './Textarea'
import { Button } from './Button'

describe('display components', () => {
  it('StatusBadge shows the name next to a tone dot', () => {
    const { container } = render(<StatusBadge name="In progress" tone="progress" />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(container.querySelector('.bg-status-progress')).not.toBeNull()
  })

  it('PriorityBadge shows the name and the level colour', () => {
    const { container } = render(<PriorityBadge name="Urgent" level="urgent" />)
    expect(screen.getByText('Urgent')).toBeInTheDocument()
    expect(container.querySelector('.text-priority-urgent')).not.toBeNull()
  })

  it('Kbd renders a kbd element', () => {
    render(<Kbd>Ctrl K</Kbd>)
    expect(screen.getByText('Ctrl K').tagName).toBe('KBD')
  })

  it('Avatar shows initials with the name as its accessible name, or an image', () => {
    const { rerender } = render(<Avatar name="Ada Lovelace" />)
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
    rerender(<Avatar name="Ada Lovelace" src="/a.png" size={32} />)
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveAttribute('src', '/a.png')
  })

  it('Skeleton is hidden from assistive technology and respects reduced motion', () => {
    const { container } = render(<Skeleton className="h-3 w-10" />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar).toHaveClass('motion-reduce:animate-none')
  })

  it('EmptyState shows its title, sentence and action', () => {
    render(
      <EmptyState
        title="No tasks"
        description="Create one to start."
        action={<Button>New task</Button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No tasks' })).toBeInTheDocument()
    expect(screen.getByText('Create one to start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument()
  })

  it('ErrorState announces the message and retries', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState message="Could not load tasks" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load tasks')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('Textarea links its label and shows its error', () => {
    render(<Textarea label="Description" error="Too long" />)
    const field = screen.getByLabelText('Description')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Too long')
  })
})
