import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ThemeSwitcher } from './ThemeSwitcher'

describe('ThemeSwitcher', () => {
  it('has one pressed button and switches on click', async () => {
    render(<ThemeSwitcher />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Aurora' }))
    expect(screen.getByRole('button', { name: 'Aurora' })).toHaveAttribute('aria-pressed', 'true')
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })
})
