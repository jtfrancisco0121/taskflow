import { useEffect, useMemo } from 'react'
import type { ViewConfig } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { useViewParams } from './viewParams'
import {
  applyUrlState,
  clearUrlState,
  isDirty,
  parseUrlState,
  URL_KEYS,
  writeUrlState,
  type UrlState,
} from './urlState'

/**
 * VIEW-3: the URL owns the view state. Changing filter, grouping or sort pushes a history entry, so
 * Back undoes the last change; an invalid parameter is dropped with a notice and the page renders.
 */
export function useViewState(base: ViewConfig) {
  const [params, setParams] = useViewParams()
  const { state, dropped } = useMemo(() => parseUrlState(params), [params])
  const show = useToastStore((s) => s.show)
  const droppedKey = dropped.join(',')

  useEffect(() => {
    if (!droppedKey) return
    show(`Ignored an invalid view parameter (${droppedKey}).`)
    const next = new URLSearchParams(params)
    droppedKey.split(',').forEach((key) => next.delete(key))
    setParams(next, { replace: true })
    // params is intentionally not a dependency: the notice is shown once per dropped set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppedKey])

  const config = useMemo(() => applyUrlState(base, state), [base, state])

  return {
    config,
    state,
    dirty: isDirty(base, state),
    update: (patch: Partial<UrlState>) => {
      const merged = { ...state, ...patch }
      URL_KEYS.forEach((key) => {
        if (merged[key] === undefined) delete merged[key]
      })
      setParams(writeUrlState(params, merged))
    },
    reset: () => setParams(clearUrlState(params)),
  }
}
