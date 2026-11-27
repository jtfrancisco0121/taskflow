import { useEffect, useRef, useState } from 'react'
import { messageOf } from '../../api/errors'
import { useCreateTask } from './useCreateTask'

/** FR-15: the last row of a List's view; Enter creates, clears and keeps focus. */
export function QuickAdd({
  workspaceId,
  listId,
  autoFocus = true,
}: {
  workspaceId: string
  listId: string
  autoFocus?: boolean
}) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateTask(workspaceId, listId)
  const pending = create.isPending

  // Focus once, on mount: not out of an open dialog (the Command palette opened while the List was loading) or
  // a field the user is already in, and not later when autoFocus flips.
  const focusTried = useRef(false)
  useEffect(() => {
    if (!autoFocus || focusTried.current) return
    focusTried.current = true
    const active = document.activeElement
    if (active?.closest('[role="dialog"], input, textarea, select, [contenteditable="true"]'))
      return
    inputRef.current?.focus()
  }, [autoFocus])

  const wasPending = useRef(false)
  useEffect(() => {
    // Disabled inputs lose focus; give it back when the create finishes.
    if (wasPending.current && !pending) inputRef.current?.focus()
    wasPending.current = pending
  }, [pending])

  function submit() {
    const value = title.trim()
    if (!value || pending) return
    create.mutate({ title: value }, { onSuccess: () => setTitle('') })
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        aria-label="Add a task"
        placeholder="Add a task"
        value={title}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') setTitle('')
        }}
        className="h-9 w-full rounded-md border border-dashed border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
      />
      {create.isError && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {messageOf(create.error)}
        </p>
      )}
    </div>
  )
}
