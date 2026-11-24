import { useEffect, useRef, useState } from 'react'
import type { Hint } from './FieldShell'

/** Per-field "Saving… / Saved (2 s) / refused" state for the Task panel. */
export function useFieldHints() {
  const [hints, setHints] = useState<Record<string, Hint | undefined>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const current = timers.current
    return () => Object.values(current).forEach(clearTimeout)
  }, [])

  function set(field: string, hint: Hint | undefined) {
    clearTimeout(timers.current[field])
    setHints((all) => ({ ...all, [field]: hint }))
    if (hint?.state === 'saved') {
      timers.current[field] = setTimeout(() => set(field, undefined), 2000)
    }
  }
  return { hints, set }
}
