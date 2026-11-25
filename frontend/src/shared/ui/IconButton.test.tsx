import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'

const icon = <svg aria-hidden="true" viewBox="0 0 16 16" />

describe('IconButton', () => {
  it('uses its label as the accessible name and as the tooltip', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <IconButton label="Close panel" onClick={onClick}>
        {icon}
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'Close panel' })
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Close panel')
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not run onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <IconButton label="Close panel" disabled onClick={onClick}>
        {icon}
      </IconButton>,
    )
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not compile without a label', () => {
    // @ts-expect-error `label` is required (CAP-4): an icon-only button must have a name.
    const bad = <IconButton>{icon}</IconButton>
    expect(bad).toBeTruthy()
  })
})
