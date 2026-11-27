import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { installFetch, json, newQueryClient } from '../../test/api'
import { scope, task } from './testSupport'
import { useViewTasks } from './useViewTasks'
import { useCreateTask } from '../tasks'

describe('useCreateTask (AD-13)', () => {
  it('shows the new task even when the List first load was already in flight and read before the insert', async () => {
    let created = false
    let releaseFirstRead: () => void = () => {}
    const firstRead = new Promise<void>((resolve) => (releaseFirstRead = resolve))
    let reads = 0
    installFetch({
      'POST /api/v1/views/query': async () => {
        reads += 1
        if (reads === 1) {
          // the server read the List before the task existed; the response only arrives later
          const items: unknown[] = []
          await firstRead
          return json({ items })
        }
        return json({ items: created ? [{ group: 'a', task: task(1) }] : [] })
      },
      'POST /api/v1/lists/:id/tasks': () => {
        created = true
        return json(task(1), 201)
      },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({
        view: useViewTasks(scope, { v: 1, group: 'status' }),
        create: useCreateTask('w1', 'l1'),
      }),
      { wrapper },
    )
    await waitFor(() => expect(reads).toBe(1))

    let creating: Promise<unknown> = Promise.resolve()
    act(() => {
      creating = result.current.create.mutateAsync({ title: 'Task 1' })
    })
    await waitFor(() => expect(created).toBe(true))
    releaseFirstRead()
    await act(() => creating)

    await waitFor(() => expect(result.current.view.items).toHaveLength(1))
  })
})
