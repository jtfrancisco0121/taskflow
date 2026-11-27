import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { TaskView } from '../../api/types'
import { installFetch, json, newQueryClient } from '../../test/api'
import { useCreateTask } from './useCreateTask'
import { useSubtasks } from './useSubtasks'

const task = (n: number, extra: Partial<TaskView> = {}): TaskView => ({
  id: `t${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  title: `Task ${n}`,
  priority: 'NORMAL',
  version: 1,
  ...extra,
})

describe('useCreateTask (AD-13): a subtask created while the scan of its List is still loading', () => {
  it('shows the new subtask in the scan', async () => {
    let release: () => void = () => {}
    const opened = new Promise<void>((resolve) => (release = resolve))
    let created = false
    let reads = 0
    const parent = task(1)
    const child = task(2, { parentTaskId: parent.id })
    installFetch({
      'GET /api/v1/tasks': async () => {
        reads += 1
        if (reads === 1) {
          await opened // the server read the List before the subtask existed
          return json({ items: [parent] })
        }
        return json({ items: created ? [parent, child] : [parent] })
      },
      'POST /api/v1/lists/:id/tasks': () => {
        created = true
        return json(child, 201)
      },
    })
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({ subtasks: useSubtasks(parent), create: useCreateTask('w1', 'l1') }),
      { wrapper },
    )
    await waitFor(() => expect(reads).toBe(1))

    let creating: Promise<unknown> = Promise.resolve()
    act(() => {
      creating = result.current.create.mutateAsync({ title: 'Task 2', parentTaskId: parent.id })
    })
    await waitFor(() => expect(created).toBe(true))
    release()
    await act(() => creating)

    await waitFor(() => expect(result.current.subtasks.data?.items).toHaveLength(1))
  })
})
