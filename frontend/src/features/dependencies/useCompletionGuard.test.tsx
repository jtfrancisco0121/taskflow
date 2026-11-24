import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { installFetch, json, renderWithProviders } from '../../test/api'
import { completesTask } from './completesTask'
import { useCompletionGuard } from './useCompletionGuard'

const blockedTask = { id: 't1', title: 'Ship release', blocked: true, blockerCount: 2 }
const deps = {
  waitingOn: [
    {
      dependencyId: 'd1',
      task: { id: 'b1', readableId: 'ACME-87', title: 'Fix login', finished: false },
    },
    { dependencyId: 'd2', task: { id: 'b2', readableId: 'ACME-88', title: 'Old', finished: true } },
  ],
  blocking: [],
  linked: [],
  hiddenCount: { waitingOn: 0, blocking: 0, linked: 0 },
}

function Harness({ onResult }: { onResult: (r: 'ok' | 'cancelled') => void }) {
  const guard = useCompletionGuard()
  return (
    <>
      <button
        onClick={() =>
          guard.confirm(blockedTask, true).then(
            () => onResult('ok'),
            () => onResult('cancelled'),
          )
        }
      >
        Complete
      </button>
      {guard.dialog}
    </>
  )
}

describe('completesTask', () => {
  it('is true only when an unfinished task moves into DONE or CLOSED', () => {
    expect(completesTask('ACTIVE', 'DONE')).toBe(true)
    expect(completesTask('NOT_STARTED', 'CLOSED')).toBe(true)
    expect(completesTask('DONE', 'CLOSED')).toBe(false)
    expect(completesTask('NOT_STARTED', 'ACTIVE')).toBe(false)
    expect(completesTask('ACTIVE', undefined)).toBe(false)
  })
})

describe('FR-6 useCompletionGuard', () => {
  it('resolves at once for a task that is not blocked or a change that does not complete', async () => {
    const { result } = renderHook(() => useCompletionGuard())
    await expect(
      result.current.confirm({ id: 't', title: 'T', blocked: false, blockerCount: 0 }, true),
    ).resolves.toBeUndefined()
    await expect(
      result.current.confirm({ id: 't', title: 'T', blocked: true, blockerCount: 1 }, false),
    ).resolves.toBeUndefined()
  })

  it('asks for a blocked task: the sentence names the count, the unfinished blockers are listed', async () => {
    installFetch({ 'GET /api/v1/tasks/:id/dependencies': () => json(deps) })
    const user = userEvent.setup()
    renderWithProviders(<Harness onResult={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Complete' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Ship release is waiting on 2 unfinished tasks',
    })
    expect(await screen.findByText('Fix login')).toBeVisible()
    expect(screen.queryByText('Old')).not.toBeInTheDocument() // finished blockers are not listed
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: 'Complete anyway' })).toBeVisible()
  })

  it('resolves on "Complete anyway"', async () => {
    installFetch({ 'GET /api/v1/tasks/:id/dependencies': () => json(deps) })
    const user = userEvent.setup()
    const results: string[] = []
    renderWithProviders(<Harness onResult={(r) => results.push(r)} />)
    await user.click(screen.getByRole('button', { name: 'Complete' }))
    await user.click(await screen.findByRole('button', { name: 'Complete anyway' }))
    expect(results).toEqual(['ok'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects on Cancel and on Escape, and nothing is sent', async () => {
    const stub = installFetch({ 'GET /api/v1/tasks/:id/dependencies': () => json(deps) })
    const user = userEvent.setup()
    const results: string[] = []
    renderWithProviders(<Harness onResult={(r) => results.push(r)} />)
    await user.click(screen.getByRole('button', { name: 'Complete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Complete' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(results).toEqual(['cancelled', 'cancelled'])
    expect(stub.calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('does not leak: a render without an ask has no dialog', () => {
    act(() => {})
    render(<Harness onResult={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
