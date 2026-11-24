import type { ViewConfig } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import type { UrlState } from './urlState'
import { withoutRefs } from './urlState'

export type DroppedField = { ref?: string; name?: string | null }

/** True when the config filters at all. */
export function hasFilter(config: ViewConfig): boolean {
  return !!config.filter && (config.filter.items ? config.filter.items.length > 0 : true)
}

/** Fields the query ignored because they are not live here (AD-8): named, with a way to drop them. */
export function DroppedNotice({
  dropped,
  config,
  update,
}: {
  dropped: DroppedField[]
  config: ViewConfig
  update?: (patch: Partial<UrlState>) => void
}) {
  if (dropped.length === 0) return null
  const names = dropped.map((d) => d.name ?? 'a deleted field').join(', ')
  return (
    <p role="status" className="mb-2 flex flex-wrap items-center gap-2 text-sm text-amber-800">
      <span>Some filters were removed because a field was deleted: {names}.</span>
      {update && (
        <Button
          onClick={() =>
            update(
              withoutRefs(
                config,
                dropped.flatMap((d) => (d.ref ? [d.ref] : [])),
              ),
            )
          }
        >
          Remove from view
        </Button>
      )}
    </p>
  )
}

/** The result of a filter that matches nothing, with the way out. */
export function NoMatches({ update }: { update?: (patch: Partial<UrlState>) => void }) {
  return (
    <p className="mb-2 flex flex-wrap items-center gap-2 text-slate-600">
      <span>No tasks match these filters.</span>
      {update && (
        <Button onClick={() => update({ f: { op: 'AND', items: [] } })}>Clear filters</Button>
      )}
    </p>
  )
}
