import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('shows its label on keyboard focus and hides it on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip label="Rename the task" delayDuration={0}>
        <Button>Rename</Button>
      </Tooltip>,
    )
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Rename the task')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows its label on hover', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip label="Rename the task" delayDuration={0}>
        <Button>Rename</Button>
      </Tooltip>,
    )
    await user.hover(screen.getByRole('button', { name: 'Rename' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Rename the task')
  })
})
