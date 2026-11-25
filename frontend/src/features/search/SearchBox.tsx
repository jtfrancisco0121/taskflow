import { useInfiniteQuery } from '@tanstack/react-query'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useLocation, useMatch, useNavigate, type Location } from 'react-router'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import type { SearchHit } from '../../api/types'
import { isTypingTarget } from '../../shared/ui/typing'

const DEBOUNCE_MS = 250

/** The server marks matches with <mark>; everything else is plain text, never HTML. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>.*?<\/mark>)/g)
  return (
    <>
      {parts.map((part, i) => {
        const match = /^<mark>(.*)<\/mark>$/.exec(part)
        return match ? (
          <mark key={i}>{match[1]}</mark>
        ) : (
          <Fragment key={i}>{part.replaceAll(/<\/?mark>/g, '')}</Fragment>
        )
      })}
    </>
  )
}

/**
 * SEARCH-1: the top-bar search. `/` focuses it from anywhere, results page 20 at a time by cursor,
 * Enter opens the task's panel over the view the user is on.
 */
export function SearchBox({ workspaceId }: { workspaceId: string }) {
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const navigate = useNavigate()
  const location = useLocation()
  const onTaskRoute = useMatch('/t/:taskId') !== null

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const query = useInfiniteQuery({
    queryKey: queryKeys.search(workspaceId, q),
    enabled: q.length >= 2,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/search', {
          params: { path: { id: workspaceId }, query: { q, cursor: pageParam, limit: 20 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const hits: SearchHit[] = query.data?.pages.flatMap((p) => p.items ?? []) ?? []

  function openHit(hit: SearchHit) {
    // Behind a panel the current location is /t/<prev>: keep that panel's own background.
    const background = onTaskRoute
      ? ((location.state as { backgroundLocation?: Location } | null)?.backgroundLocation ?? null)
      : location
    setOpen(false)
    void navigate(`/t/${hit.taskId}`, {
      state: background ? { backgroundLocation: background } : undefined,
    })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false)
      setText('')
      inputRef.current?.blur()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter' && hits[active]) {
      event.preventDefault()
      openHit(hits[active])
    }
  }

  return (
    <div className="relative w-72">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search tasks"
        aria-expanded={open && q.length >= 2}
        aria-controls={listId}
        placeholder="Search tasks (press /)"
        value={text}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && q.length >= 2 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute z-30 mt-1 max-h-96 w-[28rem] overflow-auto rounded border border-slate-200 bg-white shadow"
        >
          {query.isError && (
            <p role="alert" className="p-2 text-sm text-red-700">
              {messageOf(query.error)}
            </p>
          )}
          {query.isSuccess && hits.length === 0 && (
            <p className="p-2 text-sm text-slate-600">No tasks match “{q}”.</p>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.taskId}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openHit(hit)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-blue-50' : ''}`}
            >
              <div className="flex gap-2">
                <span className="font-mono text-xs text-slate-500">{hit.readableId}</span>
                <span className="font-medium">{hit.title}</span>
                <span className="ml-auto text-xs text-slate-500">{hit.listName}</span>
              </div>
              {hit.snippet && (
                <div className="mt-0.5 text-xs text-slate-600">
                  <Snippet text={hit.snippet} />
                </div>
              )}
            </div>
          ))}
          {query.hasNextPage && (
            <button
              type="button"
              className="w-full border-t border-slate-200 py-1.5 text-sm text-blue-700"
              disabled={query.isFetchingNextPage}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void query.fetchNextPage()}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}
