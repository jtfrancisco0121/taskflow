import type { FieldType, FieldView } from '../../api/types'

export type { FieldType }

/** Ten-hue Option palette (DESIGN.md): shown only as the dot inside an Option chip. */
export const OPTION_COLORS: Record<string, string> = {
  gray: '#6b7280',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  green: '#22c55e',
  teal: '#14b8a6',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#a855f7',
  pink: '#ec4899',
}

export const PALETTE = Object.keys(OPTION_COLORS)

type TypeEntry = {
  label: string
  /** A short text glyph, never the only signal: the label always sits next to it. */
  icon: string
  hasOptions: boolean
}

/** AD-12: the type registry. Cells, editors and filter inputs are added per type by later slices. */
export const FIELD_TYPES: Record<FieldType, TypeEntry> = {
  TEXT: { label: 'Text', icon: 'Aa', hasOptions: false },
  LONG_TEXT: { label: 'Long text', icon: 'P', hasOptions: false },
  NUMBER: { label: 'Number', icon: '#', hasOptions: false },
  DATE: { label: 'Date', icon: 'D', hasOptions: false },
  DROPDOWN: { label: 'Dropdown', icon: 'v', hasOptions: true },
  LABELS: { label: 'Labels', icon: 'L', hasOptions: true },
  CHECKBOX: { label: 'Checkbox', icon: '[x]', hasOptions: false },
  URL: { label: 'URL', icon: 'url', hasOptions: false },
  EMAIL: { label: 'Email', icon: '@', hasOptions: false },
  PEOPLE: { label: 'People', icon: 'P', hasOptions: false },
  RATING: { label: 'Rating', icon: '*', hasOptions: false },
  PROGRESS: { label: 'Progress', icon: '%', hasOptions: false },
}

/** The types the field editor offers. */
export const CREATABLE_TYPES: FieldType[] = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'DATE',
  'DROPDOWN',
  'LABELS',
  'CHECKBOX',
  'URL',
  'EMAIL',
  'PEOPLE',
  'RATING',
  'PROGRESS',
]

export const MAX_OWN_FIELDS = 50

export function typeOf(field: FieldView): FieldType {
  return field.type ?? 'TEXT'
}
