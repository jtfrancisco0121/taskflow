import { formatDay } from '../../shared/dates'
import type { FieldView } from '../../api/types'

/** A value is "empty" when the task has none: null, undefined, an empty list. */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

function configNumber(field: FieldView, key: string, fallback: number): number {
  const v = field.config?.[key]
  return typeof v === 'number' ? v : fallback
}

export function optionName(field: FieldView, id: unknown): string {
  return field.options?.find((o) => o.id === id)?.name ?? ''
}

/** The plain text of a value (accessible names, conflict messages, activity text). */
export function formatValue(field: FieldView, value: unknown): string {
  if (isEmpty(value)) return ''
  switch (field.type) {
    case 'NUMBER': {
      const decimals = configNumber(field, 'decimals', 0)
      return typeof value === 'number' && decimals > 0 ? value.toFixed(decimals) : String(value)
    }
    case 'DATE':
      return formatDay(String(value))
    case 'DROPDOWN':
      return optionName(field, value)
    case 'LABELS':
      return (value as unknown[])
        .map((id) => optionName(field, id))
        .filter(Boolean)
        .join(', ')
    case 'CHECKBOX':
      return value === true ? 'Checked' : ''
    case 'RATING':
      return `${value} of ${configNumber(field, 'max', 5)}`
    case 'PROGRESS':
      return `${value} percent`
    case 'PEOPLE':
      return `${(value as unknown[]).length} ${(value as unknown[]).length === 1 ? 'person' : 'people'}`
    default:
      return String(value)
  }
}

/** Only an absolute http(s) address is ever a link: anything else renders as plain text. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
