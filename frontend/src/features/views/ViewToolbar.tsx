import { useState } from 'react'
import type { ViewConfig, ViewFilter } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { canGroup, canSort } from '../fields'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { FilterGroup } from './FilterBuilder'
import { useScopeFields } from './useScopeFields'
import type { ViewScope } from './scope'
import type { Sort, UrlState } from './urlState'

const GROUPS: Array<[string, string]> = [
  ['none', 'No grouping'],
  ['status', 'Status'],
  ['statusGroup', 'Status group'],
  ['priority', 'Priority'],
  ['assignee', 'Assignee'],
  ['dueDate', 'Due date'],
  ['list', 'List'],
]
const SORTS: Array<[string, string]> = [
  ['manual', 'Manual'],
  ['title', 'Title'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['dueDate', 'Due date'],
  ['startDate', 'Start date'],
  ['createdAt', 'Created'],
  ['updatedAt', 'Updated'],
]

/** Filter builder, grouping and sort: every change goes to the URL at once (VIEW-3). */
export function ViewToolbar({
  scope,
  config,
  update,
  showGrouping = true,
  customGroups = true,
}: {
  scope: ViewScope
  config: ViewConfig
  update: (patch: Partial<UrlState>) => void
  showGrouping?: boolean
  /** Offer custom fields in the grouping (a Board's columns stay status, priority or assignee). */
  customGroups?: boolean
}) {
  const [open, setOpen] = useState(false)
  const statuses = useLocationStatuses(scope.workspaceId, scope.locationId)
  const { members } = useMembers(scope.workspaceId)
  const { fields } = useScopeFields(scope)
  const options = {
    fields,
    statuses: (statuses.data?.statuses ?? []).map((s) => ({ value: s.id!, label: s.name ?? '' })),
    members: members.map((m) => ({ value: m.userId!, label: m.displayName ?? m.email ?? '' })),
  }
  const root: ViewFilter = config.filter?.items ? config.filter : { op: 'AND', items: [] }
  const count = (function walk(f: ViewFilter | undefined): number {
    if (!f) return 0
    return f.items ? f.items.reduce((n, c) => n + walk(c), 0) : 1
  })(config.filter)
  const sort: Sort = {
    key: config.sort?.[0]?.key ?? 'manual',
    dir: (config.sort?.[0]?.dir as 'asc' | 'desc') ?? 'asc',
  }
  const setFilter = (next: ViewFilter) => update({ f: next })
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button aria-expanded={open} onClick={() => setOpen(!open)}>
          Filter{count > 0 ? ` (${count})` : ''}
        </Button>
        {showGrouping && (
          <label className="flex items-center gap-1">
            Group by
            <select
              aria-label="Group by"
              value={config.group ?? 'none'}
              onChange={(e) => update({ g: e.target.value })}
            >
              {GROUPS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
              {customGroups && fields.some(canGroup) && (
                <optgroup label="Custom fields">
                  {fields.filter(canGroup).map((f) => (
                    <option key={f.id} value={`cf:${f.id}`}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1">
          Sort by
          <select
            aria-label="Sort by"
            value={sort.key}
            onChange={(e) => update({ s: [{ key: e.target.value, dir: sort.dir }] })}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {fields.some(canSort) && (
              <optgroup label="Custom fields">
                {fields.filter(canSort).map((f) => (
                  <option key={f.id} value={`cf:${f.id}`}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <select
          aria-label="Sort direction"
          value={sort.dir}
          onChange={(e) =>
            update({ s: [{ key: sort.key, dir: e.target.value as 'asc' | 'desc' }] })
          }
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>
      {open && (
        <FilterGroup node={root} depth={1} options={options} onChange={(next) => setFilter(next)} />
      )}
    </div>
  )
}
