import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useMatch, useNavigate, type Location } from 'react-router'
import { api } from '../../api/client'
import { unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { SearchHit } from '../../api/types'

const DEBOUNCE_MS = 250

/**
 * SEARCH-1: the task search query shared by the top-bar box and the command palette: the text is trimmed and
 * debounced, nothing is sent under 2 characters, results page 20 at a time by cursor.
 */
export function useTaskSearch(workspaceId: string | undefined, text: string) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  const query = useInfiniteQuery({
    queryKey: queryKeys.search(workspaceId ?? '', q),
    enabled: !!workspaceId && q.length >= 2,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/search', {
          params: { path: { id: workspaceId! }, query: { q, cursor: pageParam, limit: 20 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const hits: SearchHit[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? []
  return { q, query, hits }
}

/** Opens a hit's task panel over the view the user is on (the same navigation for every search surface). */
export function useOpenTaskHit() {
  const navigate = useNavigate()
  const location = useLocation()
  const onTaskRoute = useMatch('/t/:taskId') !== null
  return (hit: Pick<SearchHit, 'taskId'>) => {
    // Behind a panel the current location is /t/<prev>: keep that panel's own background.
    const background = onTaskRoute
      ? ((location.state as { backgroundLocation?: Location } | null)?.backgroundLocation ?? null)
      : location
    void navigate(`/t/${hit.taskId}`, {
      state: background ? { backgroundLocation: background } : undefined,
    })
  }
}
