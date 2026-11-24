import { COLUMN_FIELDS, MAX_WIDTH, MIN_WIDTH, isCustomRef, type Column } from './urlState'

export const DEFAULT_WIDTH = 150

export const DEFAULT_COLUMNS: Column[] = [
  { field: 'readableId', width: 100 },
  { field: 'title', width: 320 },
  { field: 'status', width: 150 },
  { field: 'priority', width: 120 },
  { field: 'assignees', width: 160 },
  { field: 'dueDate', width: 150 },
  { field: 'tags', width: 160 },
]

export const COLUMN_LABEL: Record<string, string> = {
  readableId: 'ID',
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  assignees: 'Assignees',
  dueDate: 'Due date',
  startDate: 'Start date',
  tags: 'Tags',
  list: 'List',
  createdAt: 'Created',
  updatedAt: 'Updated',
}

/** TABLE-1: a width is always 60 to 800 pixels. */
export const clampWidth = (width: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

export function withWidth(columns: Column[], field: string, width: number): Column[] {
  return columns.map((c) => (c.field === field ? { ...c, width: clampWidth(width) } : c))
}

/** Moves a column one place left (-1) or right (1); the order lands in the URL. */
export function moveColumn(columns: Column[], field: string, direction: -1 | 1): Column[] {
  const from = columns.findIndex((c) => c.field === field)
  const to = from + direction
  if (from < 0 || to < 0 || to >= columns.length) return columns
  const next = [...columns]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Moves `field` to the place of `target` (header drag and drop). */
export function dropColumn(columns: Column[], field: string, target: string): Column[] {
  const from = columns.findIndex((c) => c.field === field)
  const to = columns.findIndex((c) => c.field === target)
  if (from < 0 || to < 0 || from === to) return columns
  const next = [...columns]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Show or hide a column; the title column cannot be hidden. */
export function toggleColumn(columns: Column[], field: string, visible: boolean): Column[] {
  if (field === 'title') return columns
  if (!visible) return columns.filter((c) => c.field !== field)
  if (columns.some((c) => c.field === field)) return columns
  if (!COLUMN_FIELDS.includes(field) && !isCustomRef(field)) return columns
  return [...columns, { field, width: DEFAULT_WIDTH }]
}
