import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useToastStore } from '../../shared/toast-store'
import { Toaster } from '../../shared/ui/Toaster'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { ListRenderer } from './ListRenderer'
import { baseRoutes, scope, task } from './testSupport'
import { useViewStore } from './viewStore'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function serve(tasks = [task(1), task(2), task(3)]) {
  return installFetch({
    ...baseRoutes,
    'POST /api/v1/views/query': () => json({ items: tasks.map((t) => ({ task: t })) }),
    'DELETE /api/v1/tasks/:id': new Response(null, { status: 204 }),
    'POST /api/v1/tasks/:id/restore': () => json(task(1)),
  } as never)
}

async function renderList() {
  renderWithProviders(
    <>
      <ListRenderer scope={scope} config={{ v: 1 }} />
      <Toaster />
      <Where />
    </>,
  )
  await screen.findByRole('link', { name: 'Task 1' })
}

const rowOf = (n: number) =>
  document.querySelector<HTMLElement>(`[data-task-id="t${n}"]`) as HTMLElement
const deletes = (stub: ReturnType<typeof serve>) => stub.calls.filter((c) => c.method === 'DELETE')

describe('List row keys (CAP-7)', () => {
  beforeEach(() => {
    useViewStore.setState({ collapsed: {}, selected: [], openEditor: null, focusedTaskId: null })
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => {
    document.querySelectorAll('[data-test-layer]').forEach((n) => n.remove())
  })

  it('j and k move focus between rows, stopping at the ends', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    await user.keyboard('j')
    await waitFor(() => expect(rowOf(2)).toHaveFocus())
    await user.keyboard('j{j}j')
    await waitFor(() => expect(rowOf(3)).toHaveFocus())
    await user.keyboard('k')
    await waitFor(() => expect(rowOf(2)).toHaveFocus())
    await user.keyboard('kk')
    await waitFor(() => expect(rowOf(1)).toHaveFocus())
  })

  it('rows are a roving tab stop and carry aria-selected', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    expect(rowOf(1)).toHaveAttribute('tabindex', '0')
    expect(rowOf(2)).toHaveAttribute('tabindex', '-1')
    rowOf(2).focus()
    await waitFor(() => expect(rowOf(2)).toHaveAttribute('tabindex', '0'))
    await user.keyboard('x')
    expect(rowOf(2).closest('[role="row"]')).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('x')
    expect(rowOf(2).closest('[role="row"]')).toHaveAttribute('aria-selected', 'false')
  })

  it('x selects the row and Escape clears the selection', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    await user.keyboard('x')
    expect(useViewStore.getState().selected).toEqual(['t1'])
    await user.keyboard('{Escape}')
    expect(useViewStore.getState().selected).toEqual([])
  })

  it('Enter opens the task only when the row itself has focus', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/t/t1'))
  })

  it('Enter on an inner control is left to that control', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    const edit = screen.getByRole('button', { name: 'Edit Title of ACME-1' })
    edit.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('where')).not.toHaveTextContent('/t/')
    expect(screen.getByRole('textbox', { name: 'Title of ACME-1' })).toBeVisible()
  })

  it('s, p, a and d open that row editor', async () => {
    serve()
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    for (const [key, field] of [
      ['s', 'status'],
      ['p', 'priority'],
      ['a', 'assignee'],
      ['d', 'due'],
    ] as const) {
      await user.keyboard(key)
      expect(useViewStore.getState().openEditor).toEqual({ taskId: 't1', field })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(useViewStore.getState().openEditor).toBeNull())
      await waitFor(() => expect(document.querySelector('[data-tf-floating]')).toBeNull())
      rowOf(1).focus()
    }
  })

  it('the key right after an editor closes is a row key again, before any deferred focus return runs', async () => {
    serve()
    // delay: null sends every key in one go, with no timer between them: Radix gives focus back to the trigger
    // only in a setTimeout after the popover unmounts, and a key pressed in that gap must not fall on the body.
    const user = userEvent.setup({ delay: null })
    await renderList()
    rowOf(1).focus()
    await user.keyboard('a')
    expect(useViewStore.getState().openEditor).toEqual({ taskId: 't1', field: 'assignee' })
    await user.keyboard('{Escape}d')
    expect(useViewStore.getState().openEditor).toEqual({ taskId: 't1', field: 'due' })
    await user.keyboard('{Escape}s')
    expect(useViewStore.getState().openEditor).toEqual({ taskId: 't1', field: 'status' })
    await user.keyboard('{Enter}p')
    expect(useViewStore.getState().openEditor).toEqual({ taskId: 't1', field: 'priority' })
  })

  it('Backspace trashes the focused row, focuses the next row and offers Undo', async () => {
    const stub = serve()
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    await user.keyboard('{Backspace}')
    expect(await screen.findByText('Moved 1 task to trash.')).toBeVisible()
    expect(deletes(stub)).toHaveLength(1)
    await waitFor(() => expect(rowOf(2)).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('Restored 1 task.'),
    )
  })

  it('Backspace on a focused row inside the selection trashes the whole selection', async () => {
    const stub = serve()
    const user = userEvent.setup()
    await renderList()
    useViewStore.setState({ selected: ['t1', 't2'] })
    rowOf(2).focus()
    await user.keyboard('{Backspace}')
    await screen.findByText('Moved 2 tasks to trash.')
    expect(deletes(stub)).toHaveLength(2)
  })

  it('a repeated Backspace does nothing; a Backspace while a trash is pending does nothing', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const stub = installFetch({
      ...baseRoutes,
      'POST /api/v1/views/query': () =>
        json({ items: [task(1), task(2), task(3)].map((t) => ({ task: t })) }),
      'DELETE /api/v1/tasks/:id': async () => {
        await gate
        return new Response(null, { status: 204 })
      },
    } as never)
    await renderList()
    rowOf(1).focus()
    fireEvent.keyDown(rowOf(1), { key: 'Backspace', repeat: true })
    expect(deletes(stub)).toHaveLength(0)
    fireEvent.keyDown(rowOf(1), { key: 'Backspace' })
    await waitFor(() => expect(deletes(stub)).toHaveLength(1))
    fireEvent.keyDown(rowOf(2), { key: 'Backspace' })
    expect(deletes(stub)).toHaveLength(1)
    release()
    await screen.findByText('Moved 1 task to trash.')
  })

  it('does nothing in a text field, under a modal dialog, with a floating layer open or with a modifier', async () => {
    const stub = serve()
    const user = userEvent.setup()
    await renderList()

    // a text field: the inline title editor keeps the key
    await user.click(screen.getByRole('button', { name: 'Edit Title of ACME-1' }))
    const box = screen.getByRole('textbox', { name: 'Title of ACME-1' })
    await user.keyboard('xj{Backspace}')
    expect(box).toHaveFocus()
    expect(useViewStore.getState().selected).toEqual([])
    expect(deletes(stub)).toHaveLength(0)
    await user.keyboard('{Escape}')

    // a modal dialog
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('data-test-layer', '')
    document.body.append(dialog)
    rowOf(1).focus()
    await user.keyboard('x')
    expect(useViewStore.getState().selected).toEqual([])
    dialog.remove()

    // a floating layer
    const layer = document.createElement('div')
    layer.setAttribute('data-tf-floating', '')
    layer.setAttribute('data-test-layer', '')
    document.body.append(layer)
    rowOf(1).focus()
    await user.keyboard('x')
    expect(useViewStore.getState().selected).toEqual([])
    layer.remove()

    // a modifier
    rowOf(1).focus()
    await user.keyboard('{Control>}x{/Control}')
    expect(useViewStore.getState().selected).toEqual([])
    await user.keyboard('x')
    expect(useViewStore.getState().selected).toEqual(['t1'])
  })

  it('a row scrolled out of the virtual window is scrolled in and focused', async () => {
    serve(Array.from({ length: 300 }, (_, i) => task(i + 1)))
    const user = userEvent.setup()
    await renderList()
    rowOf(1).focus()
    await user.keyboard('j')
    await waitFor(() => expect(rowOf(2)).toHaveFocus())
  })

  it('a row focus that lands a frame late leaves the focus in a palette opened meanwhile (AD-5)', async () => {
    serve()
    await renderList()
    rowOf(1).focus()
    fireEvent.keyDown(rowOf(1), { key: 'j' })
    // Ctrl/Cmd+K in the same frame: the palette opens and its field takes focus before the row focus lands.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-test-layer role="dialog" aria-modal="true" data-tf-floating data-tf-palette><input id="palette-field" /></div>',
    )
    const field = document.getElementById('palette-field') as HTMLInputElement
    field.focus()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(field).toHaveFocus()
    expect(rowOf(2)).not.toHaveFocus()
  })
})
