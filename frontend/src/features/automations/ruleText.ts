import type { RuleAction, RuleCondition, RuleTrigger } from '../../api/types'

export const TRIGGER_LABEL: Record<string, string> = {
  TASK_CREATED: 'Task created',
  STATUS_CHANGED: 'Status changed',
  ASSIGNEE_CHANGED: 'Assignee changed',
  CUSTOM_FIELD_CHANGED: 'Custom field changed',
  DUE_DATE_APPROACHING: 'Due date approaching (24 h before)',
  DUE_DATE_ARRIVED: 'Due date arrives',
}

export const CONDITION_LABEL: Record<string, string> = {
  STATUS: 'Status',
  PRIORITY: 'Priority',
  ASSIGNEE: 'Assignee',
  CUSTOM_FIELD: 'Custom field',
  TAG: 'Tag',
}

export const ACTION_LABEL: Record<string, string> = {
  CHANGE_STATUS: 'Change status',
  ASSIGN: 'Assign',
  SET_PRIORITY: 'Set priority',
  ADD_COMMENT: 'Add comment',
  SET_DUE_DATE: 'Set due date',
  CREATE_SUBTASK: 'Create subtask',
  SEND_NOTIFICATION: 'Send notification',
}

export const PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW', 'NONE']

type Names = { person: (id: string) => string; field: (id: string) => string }

export function describeTrigger(t: RuleTrigger, names: Names): string {
  const label = TRIGGER_LABEL[t.type ?? ''] ?? t.type ?? ''
  if (t.type === 'STATUS_CHANGED') {
    const from = t.fromStatuses?.length ? ` from ${t.fromStatuses.join(', ')}` : ''
    const to = t.toStatuses?.length ? ` to ${t.toStatuses.join(', ')}` : ''
    return `${label}${from}${to}`
  }
  if (t.type === 'ASSIGNEE_CHANGED' && t.personId)
    return `${label}: ${names.person(t.personId)} added`
  if (t.type === 'CUSTOM_FIELD_CHANGED' && t.fieldId) return `${label}: ${names.field(t.fieldId)}`
  return label
}

export function describeCondition(c: RuleCondition, names: Names): string {
  const op = (c.operator ?? '').toLowerCase().replace(/_/g, ' ')
  switch (c.type) {
    case 'STATUS':
    case 'PRIORITY':
      return `${CONDITION_LABEL[c.type]} ${op}: ${(c.values ?? []).join(', ')}`
    case 'ASSIGNEE':
      return `Assignee ${op}${c.personId ? ` ${names.person(c.personId)}` : ''}`
    case 'CUSTOM_FIELD':
      return `${c.fieldId ? names.field(c.fieldId) : 'Field'} ${op}${c.value != null ? ` ${String(c.value)}` : ''}`
    case 'TAG':
      return `Tag ${op} "${c.tag ?? ''}"`
    default:
      return c.type ?? ''
  }
}

export function describeAction(a: RuleAction, names: Names): string {
  switch (a.type) {
    case 'CHANGE_STATUS':
      return `Change status to ${a.status}`
    case 'ASSIGN':
      return a.unassignAll
        ? 'Unassign everyone'
        : `Assign ${(a.personIds ?? []).map(names.person).join(', ')}`
    case 'SET_PRIORITY':
      return `Set priority to ${a.priority}`
    case 'ADD_COMMENT':
      return `Add comment "${a.text ?? ''}"`
    case 'SET_DUE_DATE':
      return a.clearDueDate ? 'Clear the due date' : `Set due date ${a.daysAfter} days after`
    case 'CREATE_SUBTASK':
      return `Create subtask "${a.title ?? ''}"`
    case 'SEND_NOTIFICATION':
      return `Notify ${[...(a.recipients ?? []).map((r) => r.toLowerCase()), ...(a.personIds ?? []).map(names.person)].join(', ')}`
    default:
      return a.type ?? ''
  }
}
