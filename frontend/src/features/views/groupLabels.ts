import { PRIORITY_LABEL } from '../tasks'
import type { Priority } from '../../api/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  // A custom field group: date buckets read like the due date's, the empty group is "No value".
  if (group?.startsWith('cf:')) {
    if (key === 'none') return 'No value'
    if (DUE_LABEL[key]) return DUE_LABEL[key]
    // A People group is keyed by the user id: the member's name, or "Former member".
    if (members.has(key)) return members.get(key)!
    if (UUID.test(key) && (!serverLabel || serverLabel === key)) return 'Former member'
    return serverLabel ?? key
  }
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
