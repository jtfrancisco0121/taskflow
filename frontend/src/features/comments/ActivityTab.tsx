import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { AgentBadge } from '../../shared/ui/AgentBadge'
import { Button } from '../../shared/ui/Button'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { actorLabel, activitySentences, type NameLookup } from './activitySentence'

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
  const lookup: NameLookup = {
    statusName: (id) => statuses.data?.statuses?.find((s) => s.id === id)?.name,
    memberName: (id) => {
      const member = members.find((m) => m.userId === id)
      return member ? (member.displayName ?? member.email) : undefined
    },
  }
  const entries = [
    ...new Map(
      (activity.data?.pages.flatMap((page) => page.items ?? []) ?? []).map((e) => [e.id, e]),
    ).values(),
  ]

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
            {entry.actorType === 'AUTOMATION' && (
              <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs">Automation</span>
            )}
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
