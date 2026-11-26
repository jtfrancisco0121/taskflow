import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SHORTCUTS } from '../../shared/shortcuts'
import { ShortcutSheet } from './ShortcutSheet'

afterEach(() => {
  document.querySelectorAll('[data-test-layer]').forEach((n) => n.remove())
})

function renderSheet() {
  return render(
    <>
      <button type="button">Row</button>
      <input aria-label="Field" />
      <ShortcutSheet />
    </>,
  )
}

describe('ShortcutSheet (CAP-8)', () => {
  it('opens on ? with the Global and List groups, and Escape returns focus', async () => {
    const user = userEvent.setup()
    renderSheet()
    const row = screen.getByRole('button', { name: 'Row' })
    row.focus()
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(screen.getByRole('region', { name: 'Global' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'List' })).toBeVisible()
    expect(dialog.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(SHORTCUTS.length)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(row).toHaveFocus()
  })

  it('does not open in a text field', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByLabelText('Field'))
    await user.keyboard('?')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Field')).toHaveValue('?')
  })

  it('does not open under another modal dialog or with a floating layer open', async () => {
    const user = userEvent.setup()
    renderSheet()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('data-test-layer', '')
    document.body.append(modal)
    await user.keyboard('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    modal.remove()
    const layer = document.createElement('div')
    layer.setAttribute('data-tf-floating', '')
    layer.setAttribute('data-test-layer', '')
    document.body.append(layer)
    await user.keyboard('?')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  })
})
