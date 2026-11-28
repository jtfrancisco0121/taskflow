import { QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView, ViewQueryResponse } from '../../api/types'
import { installFetch, json, newQueryClient, problem } from '../../test/api'
import { VIEW_REFRESH_MS } from './taskCaches'
import { useUpdateTask } from './useUpdateTask'

// 14yq6g334tg: the task panel's write path (useUpdateTask) follows the same rule as the optimistic one: a saved or
// 409 task in another group reads every view again; one that keeps its group reads none.

const base = {
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  title: 'One',
  statusId: 'st-todo',
  priority: 'NORMAL',
  assigneeIds: [],
  version: 1,
} as unknown as TaskView
const viewKey = queryKeys.view('w1', 'l1', 'h', 'to do')

function setup(answer: (body: unknown) => Response) {
  installFetch({ 'PATCH /api/v1/tasks/:id': (_r: Request, body: unknown) => answer(body) } as never)
  const queryClient = newQueryClient()
  queryClient.setQueryData(queryKeys.task('t1'), base)
  const page: InfiniteData<ViewQueryResponse> = {
    pages: [{ items: [{ group: 'to do', task: base }] }],
    pageParams: [undefined],
  }
  queryClient.setQueryData(viewKey, page)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useUpdateTask('t1'), { wrapper })
  const invalidated = () => queryClient.getQueryState(viewKey)?.isInvalidated
  return { result, invalidated }
}

describe('useUpdateTask and view groups (14yq6g334tg)', () => {
  it('a saved status change reads the loaded views again', async () => {
    const { result, invalidated } = setup((body) =>
      json({ ...base, ...(body as object), version: 2 }),
    )
    await act(() => result.current.mutateAsync({ statusId: 'st-doing' }))
    await waitFor(() => expect(invalidated()).toBe(true))
  })

  it('a 409 whose current task is in another group reads the loaded views again', async () => {
    const { result, invalidated } = setup(() =>
      problem(409, 'task.version_conflict', 'changed', {
        current: { ...base, priority: 'URGENT', version: 5 },
      }),
    )
    await act(() => result.current.mutateAsync({ title: 'Mine' }))
    await waitFor(() => expect(invalidated()).toBe(true))
  })

  it('a saved title change reads no view again', async () => {
    const { result, invalidated } = setup((body) =>
      json({ ...base, ...(body as object), version: 2 }),
    )
    await act(() => result.current.mutateAsync({ title: 'Renamed' }))
    // Past the gathered refresh (VIEW_REFRESH_MS), so a scheduled read would have run.
    await act(() => new Promise((resolve) => setTimeout(resolve, VIEW_REFRESH_MS + 50)))
    expect(invalidated()).toBe(false)
  })
})
