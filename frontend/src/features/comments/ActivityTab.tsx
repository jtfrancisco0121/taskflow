import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ApiError, messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { AgentBadge } from '../../shared/ui/AgentBadge'
import { AutomationBadge } from '../../shared/ui/AutomationBadge'
import { Button } from '../../shared/ui/Button'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { actorLabel, activitySentences, relatedTaskIds, type NameLookup } from './activitySentence'

function useActivity(taskId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.activity(taskId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/tasks/{id}/activity', {
          params: { path: { id: taskId }, query: { cursor: pageParam, limit: 50 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

/** FR-21: newest first, actor and sentence per entry; ids resolve to names, never shown raw. */
export function ActivityTab({ task }: { task: TaskView }) {
  const activity = useActivity(task.id!)
  const statuses = useLocationStatuses(task.workspaceId, task.listId)
  const { members } = useMembers(task.workspaceId)
  const entries = [
    ...new Map(
      (activity.data?.pages.flatMap((page) => page.items ?? []) ?? []).map((e) => [e.id, e]),
    ).values(),
  ]
  // The other task of a relationship is read like any task: a refused read is "a task you can't
  // see", so a hidden task's id or title never reaches the page (AD-6).
  const relatedIds = [...new Set(entries.flatMap(relatedTaskIds))]
  const related = useQueries({
    queries: relatedIds.map((id) => ({
      queryKey: queryKeys.task(id),
      retry: false,
      queryFn: () => unwrap(api.GET('/api/v1/tasks/{id}', { params: { path: { id } } })),
    })),
  })
  const lookup: NameLookup = {
    taskName: (id) => {
      const result = related[relatedIds.indexOf(id)]
      if (!result) return undefined
      if (result.data) return result.data.readableId
      return result.error instanceof ApiError &&
        (result.error.status === 404 || result.error.status === 403)
        ? null
        : undefined
    },
    statusName: (id) => statuses.data?.statuses?.find((s) => s.id === id)?.name,
    memberName: (id) => {
      const member = members.find((m) => m.userId === id)
      return member ? (member.displayName ?? member.email) : undefined
    },
  }
  return (
    <div className="flex flex-col gap-2">
      {activity.isPending && <p role="status">Loading…</p>}
      {activity.isError && (
        <p role="alert" className="text-sm text-red-700">
          {messageOf(activity.error)}
        </p>
      )}
      {activity.isSuccess && entries.length === 0 && (
        <p className="text-sm text-slate-600">No activity yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {entries.map((entry) => (
          <li key={entry.id} className="text-sm">
            <span className="font-medium">{actorLabel(entry)}</span>
            {entry.actorType === 'SERVICE_ACCOUNT' && <AgentBadge />}
            {entry.actorType === 'AUTOMATION' && entry.automationRuleName && <AutomationBadge />}
            {activitySentences(entry, lookup).map((sentence, index) => (
              <p key={index} className="m-0">
                {sentence}
              </p>
            ))}
            <time
              dateTime={entry.createdAt}
              title={formatDateTime(entry.createdAt)}
              className="text-xs text-slate-500"
            >
              {relativeTime(entry.createdAt)}
            </time>
          </li>
        ))}
      </ul>
      {activity.hasNextPage && (
        <Button
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          Show more
        </Button>
      )}
    </div>
  )
}
