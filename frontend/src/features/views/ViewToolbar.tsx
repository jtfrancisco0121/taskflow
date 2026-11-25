import { useState } from 'react'
import type { ViewConfig, ViewFilter } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { Select } from '../../shared/ui/Select'
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
            <Select
              aria-label="Group by"
              value={config.group ?? 'none'}
              onValueChange={(next) => update({ g: next })}
              options={GROUPS.map(([value, label]) => ({ value, label }))}
              groups={
                customGroups && fields.some(canGroup)
                  ? [
                      {
                        label: 'Custom fields',
                        options: fields
                          .filter(canGroup)
                          .map((f) => ({ value: `cf:${f.id}`, label: f.name ?? '' })),
                      },
                    ]
                  : []
              }
            />
          </label>
        )}
        <label className="flex items-center gap-1">
          Sort by
          <Select
            aria-label="Sort by"
            value={sort.key}
            onValueChange={(next) => update({ s: [{ key: next, dir: sort.dir }] })}
            options={SORTS.map(([value, label]) => ({ value, label }))}
            groups={
              fields.some(canSort)
                ? [
                    {
                      label: 'Custom fields',
                      options: fields
                        .filter(canSort)
                        .map((f) => ({ value: `cf:${f.id}`, label: f.name ?? '' })),
                    },
                  ]
                : []
            }
          />
        </label>
        <Select
          aria-label="Sort direction"
          value={sort.dir}
          onValueChange={(next) => update({ s: [{ key: sort.key, dir: next as 'asc' | 'desc' }] })}
          options={[
            { value: 'asc', label: 'Ascending' },
            { value: 'desc', label: 'Descending' },
          ]}
        />
      </div>
      {open && (
        <FilterGroup node={root} depth={1} options={options} onChange={(next) => setFilter(next)} />
      )}
    </div>
  )
}
