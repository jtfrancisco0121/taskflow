import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Switch } from './Switch'

function Harness() {
  const [on, setOn] = useState(false)
  return <Switch label="Enabled" checked={on} onCheckedChange={setOn} />
}

describe('Switch', () => {
  it('toggles on click and with Space, and reports its state', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const toggle = screen.getByRole('switch', { name: 'Enabled' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    toggle.focus()
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('is not toggled when disabled', async () => {
    const user = userEvent.setup()
    render(<Switch aria-label="Off" checked={false} onCheckedChange={() => {}} disabled />)
    await user.click(screen.getByRole('switch', { name: 'Off' }))
    expect(screen.getByRole('switch', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
  })
})
