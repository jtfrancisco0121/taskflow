import type { FieldView } from '../../api/types'
import type { FieldType } from './fieldTypes'

/** Operator labels of custom field filters (field-types.md). */
export const OP_LABEL: Record<string, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  on: 'is on',
  any_of: 'is any of',
  none_of: 'is none of',
  all_of: 'has all of',
  is_set: 'is set',
  is_empty: 'is empty',
  is_checked: 'is checked',
  is_unchecked: 'is not checked',
}

const OPS: Record<FieldType, string[]> = {
  TEXT: ['contains', 'not_contains', 'is_set', 'is_empty'],
  LONG_TEXT: ['contains', 'not_contains', 'is_set', 'is_empty'],
  URL: ['contains', 'not_contains', 'is_set', 'is_empty'],
  EMAIL: ['contains', 'not_contains', 'is_set', 'is_empty'],
  NUMBER: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_set', 'is_empty'],
  DATE: ['before', 'after', 'on', 'between', 'is_set', 'is_empty'],
  DROPDOWN: ['any_of', 'none_of', 'is_set', 'is_empty'],
  LABELS: ['any_of', 'all_of', 'none_of', 'is_set', 'is_empty'],
  PEOPLE: ['any_of', 'all_of', 'none_of', 'is_set', 'is_empty'],
  CHECKBOX: ['is_checked', 'is_unchecked'],
  RATING: ['eq', 'gte', 'lte', 'is_set', 'is_empty'],
  PROGRESS: ['gte', 'lte', 'between', 'is_set', 'is_empty'],
}

const SORTABLE = new Set<FieldType>([
  'TEXT',
  'NUMBER',
  'DATE',
  'DROPDOWN',
  'CHECKBOX',
  'URL',
  'EMAIL',
  'RATING',
  'PROGRESS',
])
const GROUPABLE = new Set<FieldType>(['DATE', 'DROPDOWN', 'CHECKBOX', 'RATING', 'PEOPLE'])

export const operatorsFor = (field: FieldView): string[] => OPS[field.type ?? 'TEXT']
export const canSort = (field: FieldView) => SORTABLE.has(field.type ?? 'TEXT')
export const canGroup = (field: FieldView) => GROUPABLE.has(field.type ?? 'TEXT')

const VALUELESS = new Set(['is_set', 'is_empty', 'is_checked', 'is_unchecked'])
export const isValueless = (op: string | undefined) => VALUELESS.has(op ?? '')

/** A usable first value for a field and operator, so a new condition is valid at once. */
export function defaultValue(field: FieldView, op: string): unknown {
  if (isValueless(op)) return undefined
  if (op === 'between') return field.type === 'DATE' ? ['today', 'next_7_days'] : [0, 100]
  if (['before', 'after', 'on'].includes(op)) return 'today'
  if (['any_of', 'all_of', 'none_of'].includes(op)) {
    if (field.type === 'PEOPLE') return ['me']
    const first = field.options?.[0]?.id
    return first ? [first] : []
  }
  if (['contains', 'not_contains'].includes(op)) return 'text'
  return field.type === 'RATING' ? 1 : 0
}
