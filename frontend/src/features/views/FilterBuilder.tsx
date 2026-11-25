// TODO(slice 4): this file keeps native <select>s until the List view chip bar rebuilds the filter UI on the
// library Select (slice 4). It is one of the two named exceptions to the no-native-select lint rule.
import type { FieldView, ViewFilter } from '../../api/types'
import {
  FilterInput,
  OP_LABEL as CUSTOM_OP_LABEL,
  defaultValue,
  isValueless,
  operatorsFor,
} from '../fields'
import { PRIORITIES, PRIORITY_LABEL } from '../tasks'
import { MultiPickCell } from './cells'

type Option = { value: string; label: string }

export type FilterOptions = { statuses: Option[]; members: Option[]; fields?: FieldView[] }

const OP_LABEL: Record<string, string> = {
  any_of: 'is any of',
  none_of: 'is none of',
  all_of: 'has all of',
  contains: 'contains',
  not_contains: 'does not contain',
  is_set: 'is set',
  is_empty: 'is empty',
  before: 'is before',
  after: 'is after',
  on: 'is on',
  overdue: 'is overdue',
  include: 'include subtasks',
  exclude: 'exclude subtasks',
  is_true: 'is blocked',
  is_false: 'is not blocked',
}

type Kind = 'text' | 'priority' | 'status' | 'assignee' | 'tags' | 'date' | 'none'

const FIELDS: Record<string, { label: string; ops: string[]; kind: Kind }> = {
  title: { label: 'Title', ops: ['contains', 'not_contains'], kind: 'text' },
  priority: {
    label: 'Priority',
    ops: ['any_of', 'none_of', 'is_set', 'is_empty'],
    kind: 'priority',
  },
  status: { label: 'Status', ops: ['any_of', 'none_of'], kind: 'status' },
  assignee: {
    label: 'Assignee',
    ops: ['any_of', 'all_of', 'none_of', 'is_empty', 'is_set'],
    kind: 'assignee',
  },
  tag: { label: 'Tag', ops: ['any_of', 'all_of', 'none_of', 'is_empty'], kind: 'tags' },
  dueDate: {
    label: 'Due date',
    ops: ['before', 'after', 'on', 'is_empty', 'is_set', 'overdue'],
    kind: 'date',
  },
  startDate: {
    label: 'Start date',
    ops: ['before', 'after', 'on', 'is_empty', 'is_set'],
    kind: 'date',
  },
  subtasks: { label: 'Subtasks', ops: ['include', 'exclude'], kind: 'none' },
  blocked: { label: 'Blocked', ops: ['is_true', 'is_false'], kind: 'none' },
}

const NO_VALUE = new Set([
  'is_set',
  'is_empty',
  'overdue',
  'include',
  'exclude',
  'is_true',
  'is_false',
])

/** A fresh condition on a custom field: its first operator and a usable default value. */
function newCustomCondition(field: FieldView): ViewFilter {
  const op = operatorsFor(field)[0]
  const value = defaultValue(field, op)
  return value === undefined
    ? { field: `cf:${field.id}`, op }
    : { field: `cf:${field.id}`, op, value: value as ViewFilter['value'] }
}

/** A fresh condition for a field: its first operator and a usable default value. */
export function newCondition(field = 'priority', fields: FieldView[] = []): ViewFilter {
  if (field.startsWith('cf:')) {
    const custom = fields.find((f) => `cf:${f.id}` === field)
    if (custom) return newCustomCondition(custom)
  }
  const spec = FIELDS[field] ?? FIELDS.priority
  const op = spec.ops[0]
  const value =
    field === 'priority'
      ? ['URGENT']
      : field === 'title'
        ? 'text'
        : field === 'tag'
          ? ['tag']
          : field === 'assignee'
            ? ['me']
            : field === 'dueDate' || field === 'startDate'
              ? 'today'
              : undefined
  return NO_VALUE.has(op) || value === undefined ? { field, op } : { field, op, value }
}

const MAX_DEPTH = 3

type Props = {
  node: ViewFilter
  depth: number
  options: FilterOptions
  onChange: (next: ViewFilter) => void
  onRemove?: () => void
}

/** Nested AND/OR groups of conditions (VIEW-1, at most 3 levels deep). */
export function FilterGroup({ node, depth, options, onChange, onRemove }: Props) {
  const items = node.items ?? []
  const setItem = (index: number, next: ViewFilter) =>
    onChange({ ...node, items: items.map((item, i) => (i === index ? next : item)) })
  const removeItem = (index: number) =>
    onChange({ ...node, items: items.filter((_, i) => i !== index) })
  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-2">
      <div className="flex items-center gap-2 text-sm">
        <select
          aria-label={`Match ${depth}`}
          value={node.op}
          onChange={(e) => onChange({ ...node, op: e.target.value })}
        >
          <option value="AND">All of</option>
          <option value="OR">Any of</option>
        </select>
        {onRemove && (
          <button type="button" className="text-slate-500" onClick={onRemove}>
            Remove group
          </button>
        )}
      </div>
      {items.map((item, i) =>
        item.items ? (
          <FilterGroup
            key={i}
            node={item}
            depth={depth + 1}
            options={options}
            onChange={(next) => setItem(i, next)}
            onRemove={() => removeItem(i)}
          />
        ) : (
          <ConditionRow
            key={i}
            node={item}
            options={options}
            onChange={(next) => setItem(i, next)}
            onRemove={() => removeItem(i)}
          />
        ),
      )}
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className="text-blue-700"
          onClick={() => onChange({ ...node, items: [...items, newCondition()] })}
        >
          + Add filter
        </button>
        {depth < MAX_DEPTH && (
          <button
            type="button"
            className="text-blue-700"
            onClick={() =>
              onChange({
                ...node,
                items: [...items, { op: 'OR', items: [newCondition()] }],
              })
            }
          >
            + Add group
          </button>
        )}
      </div>
    </div>
  )
}

function ConditionRow({
  node,
  options,
  onChange,
  onRemove,
}: {
  node: ViewFilter
  options: FilterOptions
  onChange: (next: ViewFilter) => void
  onRemove: () => void
}) {
  const field = node.field ?? 'title'
  const custom = field.startsWith('cf:')
    ? options.fields?.find((f) => `cf:${f.id}` === field)
    : undefined
  const spec = FIELDS[field] ?? FIELDS.title
  const list = Array.isArray(node.value) ? (node.value as string[]) : []
  const text = typeof node.value === 'string' ? node.value : ''
  const withValue = (value: unknown) => onChange({ ...node, value: value as ViewFilter['value'] })
  const valueless = custom ? isValueless(node.op) : NO_VALUE.has(node.op ?? '')
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="Filter field"
        value={field}
        onChange={(e) => onChange(newCondition(e.target.value, options.fields))}
      >
        {Object.entries(FIELDS).map(([key, f]) => (
          <option key={key} value={key}>
            {f.label}
          </option>
        ))}
        {(options.fields ?? []).length > 0 && (
          <optgroup label="Custom fields">
            {options.fields?.map((f) => (
              <option key={f.id} value={`cf:${f.id}`}>
                {f.name}
              </option>
            ))}
          </optgroup>
        )}
        {field.startsWith('cf:') && !custom && <option value={field}>Unknown field</option>}
      </select>
      <select
        aria-label="Filter operator"
        value={node.op}
        onChange={(e) => {
          const op = e.target.value
          if (custom) {
            const value = defaultValue(custom, op)
            onChange(
              value === undefined
                ? { field, op }
                : { field, op, value: value as ViewFilter['value'] },
            )
          } else if (NO_VALUE.has(op)) onChange({ field, op })
          else onChange({ ...newCondition(field), op })
        }}
      >
        {(custom ? operatorsFor(custom) : spec.ops).map((op) => (
          <option key={op} value={op}>
            {OP_LABEL[op] ?? CUSTOM_OP_LABEL[op] ?? op}
          </option>
        ))}
      </select>
      {custom && (
        <FilterInput
          field={custom}
          op={node.op ?? ''}
          value={node.value}
          onChange={(value) => withValue(value)}
          people={[{ value: 'me', label: 'Me' }, ...options.members]}
        />
      )}
      {!custom && !valueless && spec.kind === 'text' && (
        <input
          aria-label="Filter value"
          value={text}
          className="rounded border border-slate-300 px-1"
          onChange={(e) => withValue(e.target.value)}
        />
      )}
      {!custom && !valueless && spec.kind === 'priority' && (
        <MultiPickCell
          label="Filter value"
          options={PRIORITIES.map((p) => ({
            value: p,
            label: p === 'NONE' ? 'None' : PRIORITY_LABEL[p],
          }))}
          selected={list}
          onChange={withValue}
          summary={list.length ? list.map((p) => p.toLowerCase()).join(', ') : 'choose…'}
        />
      )}
      {!custom && !valueless && spec.kind === 'status' && (
        <MultiPickCell
          label="Filter value"
          options={options.statuses}
          selected={list}
          onChange={withValue}
          summary={list.length ? `${list.length} selected` : 'choose…'}
        />
      )}
      {!custom && !valueless && spec.kind === 'assignee' && (
        <MultiPickCell
          label="Filter value"
          options={[{ value: 'me', label: 'Me' }, ...options.members]}
          selected={list}
          onChange={withValue}
          summary={list.length ? `${list.length} selected` : 'choose…'}
        />
      )}
      {!custom && !valueless && spec.kind === 'tags' && (
        <input
          aria-label="Filter value"
          value={list.join(', ')}
          className="rounded border border-slate-300 px-1"
          onChange={(e) =>
            withValue(
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
        />
      )}
      {!custom && !valueless && spec.kind === 'date' && (
        <select aria-label="Filter value" value={text} onChange={(e) => withValue(e.target.value)}>
          <option value="today">today</option>
          <option value="this_week">this week</option>
          <option value="next_7_days">next 7 days</option>
          {/^\d{4}-/.test(text) && <option value={text}>{text}</option>}
        </select>
      )}
      <button
        type="button"
        aria-label="Remove filter"
        className="text-slate-500"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  )
}
