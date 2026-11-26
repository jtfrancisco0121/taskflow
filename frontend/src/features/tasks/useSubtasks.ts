import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import type { SubtaskScan } from './taskCaches'

const PAGE = 200
const MAX_PAGES = 10

/**
 * AD-5: the subtasks of a task, until Phase 4 adds a parent filter to the API. Children live in their parent's
 * List, so one capped scan of that List (10 pages of 200, archived Lists included) is cached under its own key
 * and every task of the List reads its children from it: j/k across tasks costs one scan. It is kept fresh by
 * `taskCaches` (status edits, applied events), the trash path and the realtime patcher, not by refetching.
 */
export function useSubtasks(task: TaskView) {
  const listId = task.listId ?? ''
  return useQuery({
    queryKey: queryKeys.subtaskScan(listId),
    enabled: !!listId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SubtaskScan> => {
      const tasks: TaskView[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await unwrap(
          api.GET('/api/v1/tasks', {
            params: { query: { locationId: listId, includeArchived: true, limit: PAGE, cursor } },
          }),
        )
        tasks.push(...(data.items ?? []))
        cursor = data.nextCursor ?? undefined
        if (!cursor) return { tasks, capped: false }
      }
      return { tasks, capped: true }
    },
    select: (scan) => ({
      items: scan.tasks
        .filter((t) => t.parentTaskId === task.id)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      capped: scan.capped,
    }),
  })
}
