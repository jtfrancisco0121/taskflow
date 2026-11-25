import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Command, CommandPopover } from './Command'

function groups(onSelect = vi.fn()) {
  return [
    {
      heading: 'Tasks',
      items: [
        { value: 'plan', label: 'Plan sprint', onSelect },
        { value: 'ship', label: 'Ship release', onSelect },
      ],
    },
    { heading: 'Spaces', items: [{ value: 'eng', label: 'Engineering', onSelect }] },
  ]
}

describe('Command', () => {
  it('filters as you type and shows the empty text when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Command label="Search" groups={groups()} />)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'ship')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.clear(screen.getByRole('combobox', { name: 'Search' }))
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'zzzz')
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('runs the active item on Enter after arrow navigation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Command label="Search" groups={groups(onSelect)} />)
    await user.click(screen.getByRole('combobox', { name: 'Search' }))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('runs an item on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<Command label="Search" groups={groups(onSelect)} />)
    await user.click(screen.getByRole('option', { name: 'Engineering' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('opens inside a floating panel from a trigger', async () => {
    const user = userEvent.setup()
    render(<CommandPopover trigger={<Button>Jump to</Button>} label="Jump" groups={groups()} />)
    await user.click(screen.getByRole('button', { name: 'Jump to' }))
    const panel = await screen.findByRole('dialog', { name: 'Jump' })
    expect(panel).toHaveAttribute('data-tf-floating')
  })
})
