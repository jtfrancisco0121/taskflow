import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { ReactNode } from 'react'
import type { FieldView, ViewConfig } from '../../api/types'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { ErrorState } from '../../shared/ui/ErrorState'
import { Skeleton } from '../../shared/ui/Skeleton'
import { BoardCard } from './BoardCard'
import type { ViewScope } from './scope'
import { useViewTasks } from './useViewTasks'

export type Column = { key: string; label: string; count?: number }

/** One Board column: a droppable region of sortable cards, fed by its own query (one per group value). */
export function BoardColumn({
  column,
  heading,
  scope,
  config,
  names,
  chipFields,
}: {
  column: Column
  heading: ReactNode
  scope: ViewScope
  config: ViewConfig
  names: Map<string, string>
  chipFields: FieldView[]
}) {
  const query = useViewTasks(scope, config, { groupValue: column.key })
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` })
  const tasks = query.items.flatMap((i) => (i.task ? [i.task] : []))
  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={`w-[268px] shrink-0 rounded-lg border border-line bg-surface-2 p-2 ${isOver ? 'bg-accent-soft outline-2 outline-accent-line' : ''}`}
    >
      <h2 className="mb-2 flex items-center justify-between gap-2 px-1 text-sm font-semibold text-fg">
        <span className="flex min-w-0 items-center gap-2">{heading}</span>
        <span className="font-normal text-muted">{column.count ?? tasks.length}</span>
      </h2>
      {query.isPending && (
        <div role="status" aria-label={`Loading ${column.label}`} className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {query.isError && !query.data && (
        <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />
      )}
      <SortableContext
        items={tasks.map((t) => `${column.key}|${t.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={`flex flex-col gap-2 ${tasks.length > 0 ? 'min-h-12' : ''}`}>
          {tasks.map((task) => (
            <BoardCard
              key={task.id}
              id={`${column.key}|${task.id}`}
              task={task}
              names={names}
              chipFields={chipFields}
            />
          ))}
        </ul>
        {query.isSuccess && tasks.length === 0 && (
          <p className="min-h-12 rounded-md border border-dashed border-line-strong p-2 text-center text-xs leading-8 text-faint">
            No tasks
          </p>
        )}
      </SortableContext>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          className="mt-2 w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  )
}
