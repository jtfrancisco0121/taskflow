import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from './toast-store'
import { Toaster } from './ui/Toaster'

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

describe('toast actions', () => {
  it('renders the action as a button, runs it and dismisses the toast', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onAction = vi.fn()
    render(<Toaster />)
    act(() => {
      useToastStore.getState().show('Moved 1 task to trash.', 'info', {
        action: { label: 'Undo', onAction },
      })
    })
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Moved 1 task to trash.')).toBeNull()
  })

  it('honours durationMs and update() restarts the timer', () => {
    render(<Toaster />)
    let id = 0
    act(() => {
      id = useToastStore.getState().show('first', 'info', { durationMs: 10_000 })
    })
    act(() => void vi.advanceTimersByTime(9_000))
    expect(screen.getByText('first')).toBeInTheDocument()
    act(() => useToastStore.getState().update(id, { message: 'second' }))
    act(() => void vi.advanceTimersByTime(9_000))
    expect(screen.getByText('second')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(1_500))
    expect(screen.queryByText('second')).toBeNull()
  })
})
