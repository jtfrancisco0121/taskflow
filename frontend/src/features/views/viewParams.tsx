import { createContext, useContext } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Behind the Task panel the URL is `/t/:id`, but the view keeps the parameters of the place the
 * user came from. The background provides them here; a change navigates back to that place.
 */
export type ViewParamsOverride = { search: string; set: (next: URLSearchParams) => void }

export const ViewParamsContext = createContext<ViewParamsOverride | null>(null)

/** Like `useSearchParams`, but for the view: honours the background override. */
export function useViewParams(): [
  URLSearchParams,
  (next: URLSearchParams, options?: { replace?: boolean }) => void,
] {
  const override = useContext(ViewParamsContext)
  const [params, setParams] = useSearchParams()
  if (override) {
    return [new URLSearchParams(override.search), (next) => override.set(next)]
  }
  return [params, (next, options) => setParams(next, options)]
}
