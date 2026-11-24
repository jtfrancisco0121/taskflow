import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { useLocationInfo } from '../locations'
import { useMembers } from '../workspace'
import { QuickAdd } from './QuickAdd'
import { TaskRow } from './TaskRow'
import { useTasks } from './useTasks'

const TYPE_NAME = { SPACE: 'Space', FOLDER: 'Folder', LIST: 'List' } as const

/** Props let the Task panel route render this same view behind it (AD-3). */
export function ListViewPage({ locationId: forced }: { locationId?: string }) {
  const params = useParams()
  const workspaceId = params.workspaceId!
  const locationId = forced ?? params.locationId!
  return <ListView key={locationId} workspaceId={workspaceId} locationId={locationId} />
}

export function ListView({ workspaceId, locationId }: { workspaceId: string; locationId: string }) {
  const location = useLocationInfo(locationId)
  const tasks = useTasks(workspaceId, locationId)
  const { members } = useMembers(workspaceId)
  const memberNames = new Map(members.map((m) => [m.userId!, m.displayName ?? m.email ?? '']))
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tasks

  // Next page when the end of the list scrolls into view (the button below is the keyboard path).
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (location.isError) {
    return (
      <div>
        <p>This location doesn&apos;t exist or you don&apos;t have access.</p>
        <Link to={`/w/${workspaceId}`} className="text-blue-700 underline">
          Back to the Workspace
        </Link>
      </div>
    )
  }

  const type = location.data?.type
  // A page boundary must never show a row twice (a task edited between pages can reappear).
  const rows = [
    ...new Map(
      (tasks.data?.pages.flatMap((page) => page.items ?? []) ?? []).map((task) => [task.id, task]),
    ).values(),
  ]

  return (
    <section aria-label="List view">
      <header className="mb-4 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{location.data?.name ?? ''}</h1>
        {location.data?.isPrivate && (
          <span role="img" aria-label="Private" title="Private">
            🔒
          </span>
        )}
        {type && <span className="text-sm text-slate-500">{TYPE_NAME[type]}</span>}
      </header>
      {tasks.isPending && (
        <div role="status" aria-label="Loading tasks" className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-7 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
      )}
      {tasks.isError && (
        <p role="alert" className="text-red-700">
          {messageOf(tasks.error)}
        </p>
      )}
      {tasks.isSuccess && rows.length === 0 && (
        <p className="mb-2 text-slate-600">
          {type === 'LIST' || !type
            ? 'No tasks yet. Type a title below to add one.'
            : `No tasks in this ${TYPE_NAME[type]} yet.`}
        </p>
      )}
      {rows.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
              <th className="px-2 py-1">ID</th>
              <th className="px-2 py-1">Title</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Priority</th>
              <th className="px-2 py-1">Due</th>
              <th className="px-2 py-1">Assignees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <TaskRow key={task.id} task={task} members={memberNames} />
            ))}
          </tbody>
        </table>
      )}
      <div ref={sentinel} />
      {hasNextPage && (
        <Button className="mt-2" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Load more
        </Button>
      )}
      {type === 'LIST' && <QuickAdd workspaceId={workspaceId} listId={locationId} />}
    </section>
  )
}
