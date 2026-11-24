import { useEffect, useRef, useState } from 'react'
import { messageOf } from '../../api/errors'
import { useCreateTask } from './useCreateTask'

/** FR-15: the last row of a List's view; Enter creates, clears and keeps focus. */
export function QuickAdd({ workspaceId, listId }: { workspaceId: string; listId: string }) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const create = useCreateTask(workspaceId, listId)
  const pending = create.isPending

  useEffect(() => {
    // Disabled inputs lose focus; give it back when the create finishes.
    if (!pending) inputRef.current?.focus()
  }, [pending])

  function submit() {
    const value = title.trim()
    if (!value || pending) return
    create.mutate(value, { onSuccess: () => setTitle('') })
  }

  return (
    <div className="mt-2">
      <input
        ref={inputRef}
        aria-label="Add a task"
        placeholder="Add a task"
        value={title}
        disabled={pending}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') setTitle('')
        }}
        className="w-full rounded border border-dashed border-slate-300 px-2 py-1.5 text-sm focus:outline-2 focus:outline-blue-600"
      />
      {create.isError && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {messageOf(create.error)}
        </p>
      )}
    </div>
  )
}
