export const GROUPS = ['NOT_STARTED', 'ACTIVE', 'DONE', 'CLOSED'] as const
export type Group = (typeof GROUPS)[number]

export const GROUP_LABEL: Record<Group, string> = {
  NOT_STARTED: 'Not started',
  ACTIVE: 'Active',
  DONE: 'Done',
  CLOSED: 'Closed',
}

export const COLOR_PRESETS = [
  '#9ca3af',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#14b8a6',
  '#ec4899',
] as const

/** One row of the editable set. `id` is set only for a status the location already owns. */
export type DraftRow = {
  key: string
  id?: string
  name: string
  group: Group
  color: string
}
