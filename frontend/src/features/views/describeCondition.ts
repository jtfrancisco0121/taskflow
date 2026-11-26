import type { FieldView, ViewFilter } from '../../api/types'
import { OP_LABEL as CUSTOM_OP_LABEL } from '../fields'
import { PRIORITY_LABEL } from '../tasks'
import type { FilterOptions } from './FilterBuilder'
import { FIELDS, OP_LABEL } from './filterSpec'

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

/** Up to two labels read out, more as a count ("3 statuses"). */
function listText(labels: string[], noun: [string, string]): string {
  if (labels.length <= 2) return labels.join(', ')
  return plural(labels.length, noun[0], noun[1])
}

function nameOfCustom(field: FieldView, id: string, options: FilterOptions): string {
  if (field.type === 'PEOPLE') {
    if (id === 'me') return 'Me'
    return options.members.find((m) => m.value === id)?.label ?? id
  }
  return field.options?.find((o) => o.id === id)?.name ?? id
}

function valueText(item: ViewFilter, options: FilterOptions, custom?: FieldView): string {
  const value = item.value
  if (Array.isArray(value)) {
    if (custom) {
      return listText(
        value.map((v) => nameOfCustom(custom, String(v), options)),
        custom.type === 'PEOPLE' ? ['person', 'people'] : ['option', 'options'],
      )
    }
    switch (item.field) {
      case 'priority':
        return listText(
          value.map((v) => PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? String(v)),
          ['priority', 'priorities'],
        )
      case 'status':
        return listText(
          value.map((v) => options.statuses.find((s) => s.value === v)?.label ?? 'a status'),
          ['status', 'statuses'],
        )
      case 'assignee':
        return listText(
          value.map((v) =>
            v === 'me' ? 'Me' : (options.members.find((m) => m.value === v)?.label ?? 'someone'),
          ),
          ['person', 'people'],
        )
      default:
        return listText(value.map(String), ['value', 'values'])
    }
  }
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value.replaceAll('_', ' ') : String(value)
}

/**
 * The chip text of one filter condition (the Voice table of the slice-4 UX spec): "Priority is any of Urgent",
 * "Assignee is any of 2 people", "Unknown field" for a custom field that no longer exists.
 */
export function describeCondition(item: ViewFilter, options: FilterOptions): string {
  const field = item.field ?? 'title'
  const custom = field.startsWith('cf:')
    ? options.fields?.find((f) => `cf:${f.id}` === field)
    : undefined
  if (field.startsWith('cf:') && !custom) return 'Unknown field'
  const name = custom?.name ?? FIELDS[field]?.label ?? field
  const op = item.op ?? ''
  const opText = OP_LABEL[op] ?? CUSTOM_OP_LABEL[op] ?? op
  const value = valueText(item, options, custom)
  return [name, opText, value].filter(Boolean).join(' ')
}

/** The chip text of a nested group of conditions. */
export function describeGroup(item: ViewFilter): string {
  const n = item.items?.length ?? 0
  return `${item.op === 'OR' ? 'Any of' : 'All of'} ${plural(n, 'condition', 'conditions')}`
}
