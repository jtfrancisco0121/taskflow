import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

function Harness({ initial = false }: { initial?: boolean | 'indeterminate' }) {
  const [checked, setChecked] = useState<boolean | 'indeterminate'>(initial)
  return <Checkbox label="Select all" checked={checked} onCheckedChange={setChecked} />
}

describe('Checkbox', () => {
  it('toggles on click and with Space', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const box = screen.getByRole('checkbox', { name: 'Select all' })
    expect(box).not.toBeChecked()
    await user.click(box)
    expect(box).toBeChecked()
    box.focus()
    await user.keyboard(' ')
    expect(box).not.toBeChecked()
  })

  it('shows the indeterminate state', () => {
    render(<Harness initial="indeterminate" />)
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
  })

  it('is not toggled when disabled', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Off" checked={false} onCheckedChange={() => {}} disabled />)
    await user.click(screen.getByRole('checkbox', { name: 'Off' }))
    expect(screen.getByRole('checkbox', { name: 'Off' })).not.toBeChecked()
  })
})
