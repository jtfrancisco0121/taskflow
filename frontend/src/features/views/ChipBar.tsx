import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ViewConfig, ViewFilter } from '../../api/types'
import { Button } from '../../shared/ui/Button'
import { hasOpenFloatingLayer } from '../../shared/ui/floating'
import { Select } from '../../shared/ui/Select'
import { canGroup, canSort } from '../fields'
import { useLocationStatuses } from '../statuses'
import { useMembers } from '../workspace'
import { describeCondition, describeGroup } from './describeCondition'
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

const chip =
  'inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface-2 pl-2 text-xs text-fg'

function RemoveChip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${text}`}
      onClick={onRemove}
      className="mr-1 rounded-full px-1.5 text-muted hover:bg-surface hover:text-fg"
    >
      ✕
    </button>
  )
}

/**
 * One chip bar for filter, grouping and sort (AD-6, CAP-3): a "Filter" button that opens the builder panel, one
 * chip per top-level condition, and the group and sort controls. Every change goes to the URL at once (VIEW-3).
 */
export function ChipBar({
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
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const filterButton = useRef<HTMLButtonElement>(null)
  const statuses = useLocationStatuses(scope.workspaceId, scope.locationId)
  const { members } = useMembers(scope.workspaceId)
  const { fields } = useScopeFields(scope)
  const options = {
    fields,
    statuses: (statuses.data?.statuses ?? []).map((s) => ({ value: s.id!, label: s.name ?? '' })),
    members: members.map((m) => ({ value: m.userId!, label: m.displayName ?? m.email ?? '' })),
  }
  // A leaf filter root (the API and MCP may save one) counts as one condition.
  const root: ViewFilter = config.filter?.items
    ? config.filter
    : config.filter?.field
      ? { op: 'AND', items: [config.filter] }
      : { op: 'AND', items: [] }
  const conditions = root.items ?? []
  const count = (function walk(f: ViewFilter | undefined): number {
    if (!f) return 0
    return f.items ? f.items.reduce((n, c) => n + walk(c), 0) : 1
  })(config.filter)
  const sort: Sort = {
    key: config.sort?.[0]?.key ?? 'manual',
    dir: (config.sort?.[0]?.dir as 'asc' | 'desc') ?? 'asc',
  }
  const group = config.group ?? 'none'
  const defaultSort = sort.key === 'manual' && sort.dir === 'asc'

  useEffect(() => {
    if (focusIndex === null) return
    panel.current
      ?.querySelector<HTMLElement>(`[data-item-index="${focusIndex}"] [aria-label="Filter field"]`)
      ?.focus()
    setFocusIndex(null)
  }, [focusIndex, open])

  function onPanelKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented || hasOpenFloatingLayer()) return
    event.stopPropagation()
    setOpen(false)
    filterButton.current?.focus()
  }

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Button ref={filterButton} aria-expanded={open} onClick={() => setOpen(!open)}>
          Filter{count > 0 ? ` (${count})` : ''}
        </Button>
        {conditions.map((item, i) => {
          const text = item.items ? describeGroup(item) : describeCondition(item, options)
          return (
            <span key={i} className={chip}>
              <button
                type="button"
                onClick={() => {
                  setOpen(true)
                  setFocusIndex(i)
                }}
                className="max-w-64 truncate"
              >
                {text}
              </button>
              <RemoveChip
                text={text}
                onRemove={() =>
                  update({ f: { ...root, items: conditions.filter((_, n) => n !== i) } })
                }
              />
            </span>
          )
        })}
        {showGrouping && (
          <span className={group === 'none' ? 'flex items-center gap-1' : `${chip} pr-0`}>
            <span className="text-muted">Group by</span>
            <Select
              aria-label="Group by"
              value={group}
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
            {group !== 'none' && (
              <RemoveChip text="grouping" onRemove={() => update({ g: 'none' })} />
            )}
          </span>
        )}
        <span className={defaultSort ? 'flex items-center gap-1' : `${chip} pr-0`}>
          <span className="text-muted">Sort by</span>
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
          <Select
            aria-label="Sort direction"
            value={sort.dir}
            onValueChange={(next) =>
              update({ s: [{ key: sort.key, dir: next as 'asc' | 'desc' }] })
            }
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
          {!defaultSort && (
            <RemoveChip
              text="sorting"
              onRemove={() => update({ s: [{ key: 'manual', dir: 'asc' }] })}
            />
          )}
        </span>
      </div>
      {open && (
        <div
          ref={panel}
          onKeyDown={onPanelKey}
          className="rounded-lg border border-line bg-surface p-2"
        >
          <FilterGroup
            node={root}
            depth={1}
            options={options}
            onChange={(next) => update({ f: next })}
          />
        </div>
      )}
    </div>
  )
}
