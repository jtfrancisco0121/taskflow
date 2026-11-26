/** What each built-in filter field offers: its label, operators and the kind of value it takes. */
export const OP_LABEL: Record<string, string> = {
  any_of: 'is any of',
  none_of: 'is none of',
  all_of: 'has all of',
  contains: 'contains',
  not_contains: 'does not contain',
  is_set: 'is set',
  is_empty: 'is empty',
  before: 'is before',
  after: 'is after',
  on: 'is on',
  overdue: 'is overdue',
  include: 'include subtasks',
  exclude: 'exclude subtasks',
  is_true: 'is blocked',
  is_false: 'is not blocked',
}

export type Kind = 'text' | 'priority' | 'status' | 'assignee' | 'tags' | 'date' | 'none'

export const FIELDS: Record<string, { label: string; ops: string[]; kind: Kind }> = {
  title: { label: 'Title', ops: ['contains', 'not_contains'], kind: 'text' },
  priority: {
    label: 'Priority',
    ops: ['any_of', 'none_of', 'is_set', 'is_empty'],
    kind: 'priority',
  },
  status: { label: 'Status', ops: ['any_of', 'none_of'], kind: 'status' },
  assignee: {
    label: 'Assignee',
    ops: ['any_of', 'all_of', 'none_of', 'is_empty', 'is_set'],
    kind: 'assignee',
  },
  tag: { label: 'Tag', ops: ['any_of', 'all_of', 'none_of', 'is_empty'], kind: 'tags' },
  dueDate: {
    label: 'Due date',
    ops: ['before', 'after', 'on', 'is_empty', 'is_set', 'overdue'],
    kind: 'date',
  },
  startDate: {
    label: 'Start date',
    ops: ['before', 'after', 'on', 'is_empty', 'is_set'],
    kind: 'date',
  },
  subtasks: { label: 'Subtasks', ops: ['include', 'exclude'], kind: 'none' },
  blocked: { label: 'Blocked', ops: ['is_true', 'is_false'], kind: 'none' },
}
