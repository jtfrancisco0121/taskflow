import type { FieldView } from '../../api/types'
import { useLocationFields } from '../fields'
import type { ViewScope } from './scope'
import { isCustomRef } from './urlState'

/** The custom fields a view of this scope can show: those effective at its location, not hidden. */
export function useScopeFields(scope: ViewScope) {
  const query = useLocationFields(scope.locationId)
  const fields: FieldView[] = (query.data?.fields ?? []).filter((f) => !f.hidden)
  return { fields, byId: new Map(fields.map((f) => [f.id!, f])), query }
}

/** The custom field columns of a config that still name a live field, in order. */
export function customColumns(
  columns: Array<{ field?: string; width?: number }> | undefined,
  byId: Map<string, FieldView>,
) {
  return (columns ?? []).flatMap((c) => {
    if (!c.field || !isCustomRef(c.field)) return []
    const field = byId.get(c.field.slice(3))
    return field ? [{ column: c, field }] : []
  })
}
