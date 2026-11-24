import type { Priority } from '../../api/types'

export const PRIORITY_LABEL: Record<Priority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
  NONE: '—',
}

export const PRIORITIES: Priority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW', 'NONE']

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}
