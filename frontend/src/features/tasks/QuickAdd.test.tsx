import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFetch, renderWithProviders } from '../../test/api'
import { QuickAdd } from './QuickAdd'

// AD-9: a composer that mounts late (List data arriving) must not pull focus out of an open dialog such as the
// Command palette, or the key the user types next goes to the composer.
describe('QuickAdd focus', () => {
  it('takes focus on mount when nothing else holds it', () => {
    installFetch({})
    renderWithProviders(<QuickAdd workspaceId="w1" listId="l1" />)
    expect(screen.getByRole('textbox', { name: 'Add a task' })).toHaveFocus()
  })

  it('leaves focus alone while a dialog holds it', () => {
    installFetch({})
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const field = document.createElement('input')
    dialog.append(field)
    document.body.append(dialog)
    field.focus()
    try {
      renderWithProviders(<QuickAdd workspaceId="w1" listId="l1" />)
      expect(field).toHaveFocus()
      expect(screen.getByRole('textbox', { name: 'Add a task' })).not.toHaveFocus()
    } finally {
      dialog.remove()
    }
  })

  it('does not focus when autoFocus is off', () => {
    installFetch({})
    renderWithProviders(<QuickAdd workspaceId="w1" listId="l1" autoFocus={false} />)
    expect(screen.getByRole('textbox', { name: 'Add a task' })).not.toHaveFocus()
  })
})
