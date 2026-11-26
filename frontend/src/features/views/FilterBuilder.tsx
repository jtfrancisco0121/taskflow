import type { FieldView, ViewFilter } from '../../api/types'
import {
  FilterInput,
  OP_LABEL as CUSTOM_OP_LABEL,
  defaultValue,
  isValueless,
  operatorsFor,
} from '../fields'
import { PRIORITIES, PRIORITY_LABEL } from '../tasks'
import { Button } from '../../shared/ui/Button'
import { Picker } from '../../shared/ui/Picker'
import { Select } from '../../shared/ui/Select'
import { FIELDS, OP_LABEL } from './filterSpec'

type Option = { value: string; label: string }

const inputClass =
  'h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg placeholder:text-faint'

/** A multi-choice value (priority, status, assignee): a trigger with a summary that opens a Picker. */
function MultiValue({
  options,
  selected,
  onChange,
  summary,
}: {
  options: Option[]
  selected: string[]
  onChange: (next: string[]) => void
  summary: string
}) {
  return (
    <Picker
      mode="multi"
      label="Filter value options"
      trigger={
        <button
          type="button"
          aria-label="Filter value"
          className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg"
        >
          {summary}
        </button>
      }
      items={options}
      selected={selected}
      onPick={(value) =>
        onChange(
          selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
        )
      }
    />
  )
}

export type FilterOptions = { statuses: Option[]; members: Option[]; fields?: FieldView[] }

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
    <div className="flex flex-col gap-2 rounded-lg border border-line p-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Select
          aria-label={`Match ${depth}`}
          value={node.op ?? 'AND'}
          onValueChange={(op) => onChange({ ...node, op })}
          options={[
            { value: 'AND', label: 'All of' },
            { value: 'OR', label: 'Any of' },
          ]}
        />
        {onRemove && (
          <Button variant="ghost" onClick={onRemove}>
            Remove group
          </Button>
        )}
      </div>
      {items.map((item, i) => (
        <div key={i} data-item-index={i}>
          {item.items ? (
            <FilterGroup
              node={item}
              depth={depth + 1}
              options={options}
              onChange={(next) => setItem(i, next)}
              onRemove={() => removeItem(i)}
            />
          ) : (
            <ConditionRow
              node={item}
              options={options}
              onChange={(next) => setItem(i, next)}
              onRemove={() => removeItem(i)}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2 text-[13px]">
        <Button onClick={() => onChange({ ...node, items: [...items, newCondition()] })}>
          + Add filter
        </Button>
        {depth < MAX_DEPTH && (
          <Button
            onClick={() =>
              onChange({
                ...node,
                items: [...items, { op: 'OR', items: [newCondition()] }],
              })
            }
          >
            + Add group
          </Button>
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
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <Select
        aria-label="Filter field"
        value={field}
        onValueChange={(next) => onChange(newCondition(next, options.fields))}
        options={[
          ...Object.entries(FIELDS).map(([key, f]) => ({ value: key, label: f.label })),
          ...(field.startsWith('cf:') && !custom ? [{ value: field, label: 'Unknown field' }] : []),
        ]}
        groups={
          (options.fields ?? []).length > 0
            ? [
                {
                  label: 'Custom fields',
                  options: (options.fields ?? []).map((f) => ({
                    value: `cf:${f.id}`,
                    label: f.name ?? '',
                  })),
                },
              ]
            : []
        }
      />
      <Select
        aria-label="Filter operator"
        value={node.op ?? ''}
        placeholder="Choose…"
        onValueChange={(op) => {
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
        options={(custom ? operatorsFor(custom) : spec.ops).map((op) => ({
          value: op,
          label: OP_LABEL[op] ?? CUSTOM_OP_LABEL[op] ?? op,
        }))}
      />
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
          className={inputClass}
          onChange={(e) => withValue(e.target.value)}
        />
      )}
      {!custom && !valueless && spec.kind === 'priority' && (
        <MultiValue
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
        <MultiValue
          options={options.statuses}
          selected={list}
          onChange={withValue}
          summary={list.length ? `${list.length} selected` : 'choose…'}
        />
      )}
      {!custom && !valueless && spec.kind === 'assignee' && (
        <MultiValue
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
          className={inputClass}
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
        <Select
          aria-label="Filter value"
          value={text}
          onValueChange={withValue}
          options={[
            { value: 'today', label: 'today' },
            { value: 'this_week', label: 'this week' },
            { value: 'next_7_days', label: 'next 7 days' },
            ...(/^\d{4}-/.test(text) ? [{ value: text, label: text }] : []),
          ]}
        />
      )}
      <Button variant="ghost" aria-label="Remove filter" onClick={onRemove}>
        ✕
      </Button>
    </div>
  )
}
