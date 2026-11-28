import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { messageOf } from '../../api/errors'
import type { SearchHit } from '../../api/types'
import { isTypingTarget } from '../../shared/ui/typing'
import { useOpenTaskHit, useTaskSearch } from './useTaskSearch'
import { hasData, loadFailed } from '../../api/queryState'

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
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const { q, query, hits } = useTaskSearch(workspaceId, text)
  const openTask = useOpenTaskHit()

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

  function openHit(hit: SearchHit) {
    setOpen(false)
    openTask(hit)
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
        className="h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint"
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
          className="glass absolute z-(--tf-z-floating) mt-1 max-h-96 w-[28rem] overflow-auto rounded-lg"
        >
          {loadFailed(query) && (
            <p role="alert" className="p-2 text-sm text-danger">
              {messageOf(query.error)}
            </p>
          )}
          {hasData(query) && hits.length === 0 && (
            <p className="p-2 text-sm text-muted">No tasks match “{q}”.</p>
          )}
          {hits.map((hit, i) => (
            <div
              key={hit.taskId}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openHit(hit)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-accent-soft' : ''}`}
            >
              <div className="flex gap-2">
                <span className="font-mono text-xs text-muted">{hit.readableId}</span>
                <span className="font-medium">{hit.title}</span>
                <span className="ml-auto text-xs text-muted">{hit.listName}</span>
              </div>
              {hit.snippet && (
                <div className="mt-0.5 text-xs text-muted">
                  <Snippet text={hit.snippet} />
                </div>
              )}
            </div>
          ))}
          {query.hasNextPage && (
            <button
              type="button"
              className="w-full border-t border-line py-1.5 text-sm text-accent"
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
