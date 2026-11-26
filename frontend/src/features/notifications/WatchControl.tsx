import { messageOf } from '../../api/errors'
import { useToastStore } from '../../shared/toast-store'
import { useSetWatching, useWatchers } from './useWatchers'

/** "Watching (N)" / "Watch" in the task panel header: who is told about this task (CAP-10). */
export function WatchControl({ taskId }: { taskId: string }) {
  const watchers = useWatchers(taskId)
  const set = useSetWatching(taskId)
  const toast = useToastStore((s) => s.show)
  if (!watchers.data) return null
  const watching = watchers.data.watching ?? false
  return (
    <button
      type="button"
      aria-pressed={watching}
      disabled={set.isPending}
      onClick={() => set.mutate(!watching, { onError: (e) => toast(messageOf(e), 'error') })}
      className="rounded border border-line-strong px-2 py-0.5 text-xs font-medium hover:bg-surface-2 focus:outline-2 focus:outline-offset-2 focus:outline-focus-ring"
    >
      {watching ? `Watching (${watchers.data.count ?? 0})` : 'Watch'}
    </button>
  )
}
