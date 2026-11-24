import { PRIORITY_LABEL } from '../tasks'
import type { Priority } from '../../api/types'

const DUE_LABEL: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  this_week: 'This week',
  later: 'Later',
  none: 'No date',
}

const STATUS_GROUP_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  ACTIVE: 'Active',
  DONE: 'Done',
  CLOSED: 'Closed',
}

/** The heading of a group: what the server calls it, made readable. */
export function groupLabel(
  group: string | undefined,
  key: string,
  serverLabel: string | undefined,
  members: Map<string, string>,
): string {
  switch (group) {
    case 'priority':
      return PRIORITY_LABEL[key as Priority] === '—'
        ? 'No priority'
        : (PRIORITY_LABEL[key as Priority] ?? key)
    case 'assignee':
      return key === 'none' ? 'Unassigned' : (members.get(key) ?? 'Former member')
    case 'dueDate':
      return DUE_LABEL[key] ?? key
    case 'statusGroup':
      return STATUS_GROUP_LABEL[key] ?? key
    default:
      return serverLabel ?? key
  }
}
