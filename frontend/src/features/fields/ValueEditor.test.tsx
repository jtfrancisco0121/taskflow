import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { FieldView } from '../../api/types'
import { formatValue, safeHref } from './format'
import { ValueCell } from './ValueCell'
import { ValueEditor } from './ValueEditor'

const field = (type: FieldView['type'], extra: Partial<FieldView> = {}): FieldView => ({
  id: 'f1',
  name: 'Field',
  type,
  config: {},
  options: [],
  version: 1,
  ...extra,
})

const tier = field('DROPDOWN', {
  name: 'Customer tier',
  options: [
    { id: 'o1', name: 'Free', color: 'gray' },
    { id: 'o2', name: 'Enterprise', color: 'purple' },
  ],
})

describe('value cells (AD-12)', () => {
  it('an empty value shows a dash with the accessible name "empty"', () => {
    render(<ValueCell field={field('TEXT')} value={undefined} />)
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('XSS: a javascript: URL renders as plain text, never as a link', () => {
    render(<ValueCell field={field('URL')} value="javascript:alert(1)" />)
    expect(screen.getByText('javascript:alert(1)')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(safeHref('javascript:alert(1)')).toBeNull()
  })

  it('an http(s) URL is a link that opens safely in a new tab', () => {
    render(<ValueCell field={field('URL')} value="https://example.com/a" />)
    const link = screen.getByRole('link', { name: 'https://example.com/a' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('text is rendered as text, not as markup', () => {
    const { container } = render(<ValueCell field={field('TEXT')} value="<b>bold</b>" />)
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>bold</b>')).toBeVisible()
  })

  it('a Dropdown shows the Option as a chip and Labels show one chip each', () => {
    const { rerender } = render(<ValueCell field={tier} value="o2" />)
    expect(screen.getByText('Enterprise')).toBeVisible()
    rerender(<ValueCell field={{ ...tier, type: 'LABELS' }} value={['o1', 'o2']} />)
    expect(screen.getByText('Free')).toBeVisible()
    expect(screen.getByText('Enterprise')).toBeVisible()
  })

  it('formats each type for text', () => {
    expect(formatValue(field('NUMBER', { config: { decimals: 2 } }), 3)).toBe('3.00')
    expect(formatValue(field('RATING', { config: { max: 5 } }), 3)).toBe('3 of 5')
    expect(formatValue(field('PROGRESS'), 40)).toBe('40 percent')
    expect(formatValue(field('CHECKBOX'), true)).toBe('Checked')
    expect(formatValue(field('DATE'), '2026-12-31T00:00:00Z')).toBe('Dec 31, 2026')
    expect(formatValue(tier, 'o1')).toBe('Free')
    expect(formatValue(tier, 'gone')).toBe('')
  })

  it('a rating exposes its value as text', () => {
    render(<ValueCell field={field('RATING', { config: { max: 5 } })} value={3} />)
    expect(screen.getByRole('img', { name: '3 of 5' })).toBeVisible()
  })
})

describe('value editors (AD-12)', () => {
  it('Text commits on Enter and trims; empty text commits null; Escape cancels', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<ValueEditor field={field('TEXT')} value="old" label="Notes" onCommit={onCommit} />)
    const box = screen.getByRole('textbox', { name: 'Notes' })

    await user.clear(box)
    await user.type(box, '  new  {Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('new')

    await user.clear(box)
    await user.type(box, 'x{Escape}')
    expect(onCommit).toHaveBeenCalledTimes(1)

    await user.clear(box)
    await user.keyboard('{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('Number commits a number, and non-numeric text as typed so the server explains', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(
      <ValueEditor field={field('NUMBER')} value={undefined} label="Points" onCommit={onCommit} />,
    )
    const box = screen.getByRole('textbox', { name: 'Points' })

    await user.type(box, '5{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(5)
    await user.type(box, 'abc{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('abc')
  })

  it('Dropdown commits the option id and clears with the dash', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<ValueEditor field={tier} value="o1" label="Tier" onCommit={onCommit} />)
    const select = screen.getByRole('combobox', { name: 'Tier' })

    await user.selectOptions(select, 'Enterprise')
    expect(onCommit).toHaveBeenLastCalledWith('o2')
    await user.selectOptions(select, '—')
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('Labels toggle options and clear when none is left', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(
      <ValueEditor
        field={{ ...tier, type: 'LABELS' }}
        value={['o1']}
        label="Tags"
        onCommit={onCommit}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Enterprise' }))
    expect(onCommit).toHaveBeenLastCalledWith(['o1', 'o2'])
    await user.click(screen.getByRole('checkbox', { name: 'Free' }))
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('Checkbox commits true, and null when unchecked', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <ValueEditor field={field('CHECKBOX')} value={undefined} label="Done" onCommit={onCommit} />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Done' }))
    expect(onCommit).toHaveBeenLastCalledWith(true)
    rerender(
      <ValueEditor field={field('CHECKBOX')} value={true} label="Done" onCommit={onCommit} />,
    )
    await user.click(screen.getByRole('checkbox', { name: 'Done' }))
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('Rating commits a star and clicking the current value clears it', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(
      <ValueEditor
        field={field('RATING', { config: { max: 5 } })}
        value={3}
        label="Stars"
        onCommit={onCommit}
      />,
    )
    await user.click(screen.getByRole('button', { name: '4 of 5' }))
    expect(onCommit).toHaveBeenLastCalledWith(4)
    await user.click(screen.getByRole('button', { name: '3 of 5' }))
    expect(onCommit).toHaveBeenLastCalledWith(null)
  })

  it('Date commits a day and clears with null; URL and Email commit text', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <ValueEditor field={field('DATE')} value={undefined} label="Due" onCommit={onCommit} />,
    )
    await user.type(screen.getByLabelText('Due'), '2026-12-31')
    expect(onCommit).toHaveBeenLastCalledWith('2026-12-31T00:00:00Z')

    rerender(
      <ValueEditor field={field('URL')} value={undefined} label="Link" onCommit={onCommit} />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://a.example{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('https://a.example')
    rerender(
      <ValueEditor field={field('EMAIL')} value={undefined} label="Mail" onCommit={onCommit} />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Mail' }), 'a@b.co{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith('a@b.co')
  })
})
