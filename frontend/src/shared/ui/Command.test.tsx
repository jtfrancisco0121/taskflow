import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { useState } from 'react'
import { Command, CommandPopover, type CommandGroup } from './Command'

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

  it('reports the typed text through onSearchChange (controlled search)', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    function Host() {
      const [search, setSearch] = useState('')
      return (
        <Command
          label="Search"
          groups={groups()}
          search={search}
          onSearchChange={(value) => {
            onSearchChange(value)
            setSearch(value)
          }}
        />
      )
    }
    render(<Host />)
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'shi')
    expect(onSearchChange).toHaveBeenLastCalledWith('shi')
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveValue('shi')
    expect(screen.getAllByRole('option')).toHaveLength(1)
  })

  describe('server-backed groups', () => {
    const served = (onSelect = vi.fn(), status?: CommandGroup['status']): CommandGroup[] => [
      { heading: 'Go to', items: [{ value: 'inbox', label: 'Inbox', onSelect }] },
      {
        heading: 'Tasks',
        filter: false,
        status,
        items: [{ value: 'task:1', label: 'Quarterly numbers', onSelect }],
      },
    ]

    it('never hides a server item whose label lacks the query, while static groups still filter', async () => {
      const user = userEvent.setup()
      render(<Command label="Search" groups={served()} />)
      await user.type(screen.getByRole('combobox', { name: 'Search' }), 'zeppelin')
      expect(screen.getByRole('option', { name: /Quarterly numbers/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: 'Inbox' })).not.toBeInTheDocument()
      await user.clear(screen.getByRole('combobox', { name: 'Search' }))
      await user.type(screen.getByRole('combobox', { name: 'Search' }), 'inb')
      expect(screen.getByRole('option', { name: 'Inbox' })).toBeInTheDocument()
    })

    it('renders a status row that is not selectable', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(
        <Command
          label="Search"
          groups={served(onSelect, { kind: 'loading', text: 'Searching…' })}
        />,
      )
      const status = screen.getByRole('status')
      expect(status).toHaveTextContent('Searching…')
      expect(screen.getAllByRole('option')).toHaveLength(2)
      await user.click(status)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('shows an error row while other groups keep working', () => {
      render(
        <Command
          label="Search"
          groups={served(vi.fn(), { kind: 'error', text: 'Search failed' })}
        />,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Search failed')
      expect(screen.getByRole('option', { name: 'Inbox' })).toBeInTheDocument()
    })
  })
})
