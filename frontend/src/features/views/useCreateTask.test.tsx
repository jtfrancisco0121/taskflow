import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useCreateTask } from '../tasks'
import { scope, task } from './testSupport'
import { useViewTasks } from './useViewTasks'

/** A first read that answers only when released, like a slow request that the server served before the create. */
function gate() {
  let release: () => void = () => {}
  const opened = new Promise<void>((resolve) => (release = resolve))
  return { opened, release }
}

function setup() {
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper }
}

describe('useCreateTask (AD-13): a first load in flight when the create lands', () => {
  it('shows the new task in the List view', async () => {
    const first = gate()
    let created = false
    let reads = 0
    installFetch({
      'POST /api/v1/views/query': async () => {
        reads += 1
        if (reads === 1) {
          await first.opened
          return json({ items: [] })
        }
        return json({ items: created ? [{ group: 'a', task: task(1) }] : [] })
      },
      'POST /api/v1/lists/:id/tasks': () => {
        created = true
        return json(task(1), 201)
      },
    })
    const { wrapper } = setup()
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
    first.release()
    await act(() => creating)

    await waitFor(() => expect(result.current.view.items).toHaveLength(1))
  })

  it('refreshes a task list of the Workspace', async () => {
    const first = gate()
    let created = false
    let reads = 0
    installFetch({
      'POST /api/v1/lists/:id/tasks': () => {
        created = true
        return json(task(1), 201)
      },
    })
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        list: useQuery({
          queryKey: queryKeys.tasks('w1', 'l1'),
          queryFn: async () => {
            reads += 1
            if (reads === 1) {
              await first.opened
              return [] as string[]
            }
            return created ? ['t1'] : []
          },
        }),
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
    first.release()
    await act(() => creating)

    await waitFor(() => expect(result.current.list.data).toEqual(['t1']))
  })
})
