import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BlockedBadge } from './BlockedBadge'

describe('BlockedBadge', () => {
  it('FR-10: its accessible name says how many tasks block it', () => {
    render(<BlockedBadge blocked count={2} />)
    expect(screen.getByRole('img', { name: 'Blocked by 2 tasks' })).toBeVisible()
  })

  it('FR-10: one blocker reads in the singular, the panel form shows the count', () => {
    render(<BlockedBadge blocked count={1} showCount />)
    const badge = screen.getByRole('img', { name: 'Blocked by 1 task' })
    expect(badge).toHaveTextContent('Blocked · 1')
  })

  it('FR-10: nothing is drawn for a task that is not blocked', () => {
    const { container } = render(<BlockedBadge blocked={false} count={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})
