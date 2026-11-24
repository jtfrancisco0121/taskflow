import type { InfiniteData } from '@tanstack/react-query'
import type { MoveTaskBody, TaskView, ViewItem, ViewQueryResponse } from '../../api/types'

export type ColumnItems = Record<string, TaskView[]>

export type DropPlan = {
  from: string
  to: string
  /** Where the card sits in the target column after the drop. */
  index: number
  body: Pick<MoveTaskBody, 'beforeId' | 'afterId' | 'keepRank'>
}

/**
 * BOARD-1: where a dropped card lands and which neighbours the server needs. `beforeId` or
 * `afterId` go out only when the sort is manual and that neighbour is in the same List with the
 * same parent as the card; otherwise the request says `keepRank`. A rank is never sent.
 */
export function planDrop(
  columns: ColumnItems,
  card: TaskView,
  from: string,
  to: string,
  overTaskId: string | null,
  manualSort: boolean,
): DropPlan {
  const target = (columns[to] ?? []).filter((t) => t.id !== card.id)
  let index = overTaskId ? target.findIndex((t) => t.id === overTaskId) : -1
  if (index < 0) index = target.length
  else if (from === to) {
    // moving down within a column: the card lands after the card it was dropped on
    const original = (columns[from] ?? []).findIndex((t) => t.id === card.id)
    const overOriginal = (columns[from] ?? []).findIndex((t) => t.id === overTaskId)
    if (overOriginal > original) index += 1
  }
  const eligible = (t: TaskView | undefined) =>
    !!t && t.listId === card.listId && (t.parentTaskId ?? null) === (card.parentTaskId ?? null)
  const next = target[index]
  const prev = target[index - 1]
  if (manualSort && eligible(next)) return { from, to, index, body: { beforeId: next.id } }
  if (manualSort && eligible(prev)) return { from, to, index, body: { afterId: prev.id } }
  return { from, to, index, body: { keepRank: true } }
}

type Pages = InfiniteData<ViewQueryResponse>

export function removeItem(data: Pages | undefined, taskId: string): Pages | undefined {
  if (!data?.pages) return data
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items?.filter((i) => i.task?.id !== taskId) })),
  }
}

export function insertItem(
  data: Pages | undefined,
  index: number,
  item: ViewItem,
): Pages | undefined {
  if (!data?.pages?.length) return data
  let remaining = index
  const pages = data.pages.map((p, i) => {
    const items = [...(p.items ?? [])]
    const isLast = i === data.pages.length - 1
    if (remaining <= items.length && (remaining < items.length || isLast)) {
      items.splice(remaining, 0, item)
      remaining = Number.POSITIVE_INFINITY
    } else if (remaining !== Number.POSITIVE_INFINITY) {
      remaining -= items.length
    }
    return { ...p, items }
  })
  return { ...data, pages }
}

/** The group key a card carries after it is dropped in `to`, as the request names the target. */
export function targetFields(
  group: string,
  to: string,
  from: string,
  label: string,
): Pick<MoveTaskBody, 'statusName' | 'priority' | 'assigneeFrom' | 'assigneeTo'> {
  if (group === 'priority') return { priority: to as MoveTaskBody['priority'] }
  if (group === 'assignee') {
    return {
      assigneeFrom: from === 'none' ? undefined : from,
      assigneeTo: to === 'none' ? undefined : to,
    }
  }
  return { statusName: label }
}
