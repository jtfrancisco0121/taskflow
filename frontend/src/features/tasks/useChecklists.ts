import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { setDataRestartingFetches } from '../../api/refresh'
import type {
  ChecklistItemView as ChecklistItem,
  ChecklistView as Checklist,
} from '../../api/types'

export type { Checklist, ChecklistItem }

export function useChecklists(taskId: string) {
  return useQuery({
    queryKey: queryKeys.checklists(taskId),
    queryFn: () =>
      unwrap(api.GET('/api/v1/tasks/{id}/checklists', { params: { path: { id: taskId } } })),
  })
}

const replace = (list: Checklist[] | undefined, next: Checklist) =>
  list?.some((c) => c.id === next.id)
    ? list.map((c) => (c.id === next.id ? next : c))
    : [...(list ?? []), next]

/**
 * CAP-8: every checklist write returns the whole ChecklistView, which replaces that checklist in the cache (a
 * delete removes it). There is no If-Match, so writes on one checklist run one after another, never in parallel.
 * A refusal puts the previous entry back and resolves with the server's message; success resolves with null.
 */
export function useChecklistWrites(taskId: string) {
  const queryClient: QueryClient = useQueryClient()
  const key = queryKeys.checklists(taskId)
  const chains = useRef(new Map<string, Promise<unknown>>())

  function write(
    checklistId: string,
    call: () => Promise<Checklist | undefined>,
    optimistic?: (current: Checklist) => Checklist,
  ): Promise<string | null> {
    const run = async (): Promise<string | null> => {
      const before = queryClient.getQueryData<Checklist[]>(key)
      const current = before?.find((c) => c.id === checklistId)
      if (optimistic && current) {
        queryClient.setQueryData<Checklist[]>(key, replace(before, optimistic(current)))
      }
      try {
        const next = await call()
        queryClient.setQueryData<Checklist[]>(key, (list) =>
          next ? replace(list, next) : (list ?? []).filter((c) => c.id !== checklistId),
        )
        return null
      } catch (error) {
        queryClient.setQueryData<Checklist[]>(key, (list) =>
          current ? replace(list, current) : list,
        )
        return messageOf(error)
      }
    }
    const last = chains.current.get(checklistId) ?? Promise.resolve()
    const result = last.then(run)
    chains.current.set(checklistId, result)
    return result
  }

  const id = (value: string | undefined) => ({ params: { path: { id: value! } } })
  return {
    /** Creates a checklist; resolves with the new one, or with the refusal's message. */
    add: async (name: string): Promise<{ created?: Checklist; message?: string }> => {
      try {
        const created = await unwrap(
          api.POST('/api/v1/tasks/{id}/checklists', { ...id(taskId), body: { name } }),
        )
        // "Add checklist" is clickable while the list is on its first load, which read before this write.
        setDataRestartingFetches<Checklist[]>(queryClient, key, (list) => replace(list, created))
        return { created }
      } catch (error) {
        return { message: messageOf(error) }
      }
    },
    rename: (c: Checklist, name: string) =>
      write(
        c.id!,
        () => unwrap(api.PATCH('/api/v1/checklists/{id}', { ...id(c.id), body: { name } })),
        (cur) => ({ ...cur, name }),
      ),
    remove: (c: Checklist) =>
      write(c.id!, async () => {
        await unwrap(api.DELETE('/api/v1/checklists/{id}', id(c.id)))
        return undefined
      }),
    addItem: (c: Checklist, text: string) =>
      write(c.id!, () =>
        unwrap(api.POST('/api/v1/checklists/{id}/items', { ...id(c.id), body: { text } })),
      ),
    editItem: (c: Checklist, item: ChecklistItem, change: { text?: string; checked?: boolean }) =>
      write(
        c.id!,
        () => unwrap(api.PATCH('/api/v1/checklist-items/{id}', { ...id(item.id), body: change })),
        (cur) => ({
          ...cur,
          items: cur.items?.map((i) => (i.id === item.id ? { ...i, ...change } : i)),
        }),
      ),
    removeItem: (c: Checklist, item: ChecklistItem) =>
      write(c.id!, async () => {
        await unwrap(api.DELETE('/api/v1/checklist-items/{id}', id(item.id)))
        const cur = queryClient.getQueryData<Checklist[]>(key)?.find((x) => x.id === c.id)
        return { ...c, ...cur, items: (cur ?? c).items?.filter((i) => i.id !== item.id) }
      }),
  }
}
