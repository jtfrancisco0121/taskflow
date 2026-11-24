import type { ActivityView } from '../../api/types'
import { formatDay } from '../../shared/dates'

/** Lookups the sentence needs so raw UUIDs are never shown. */
export type NameLookup = {
  statusName: (id: string) => string | undefined
  memberName: (id: string) => string | undefined
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIORITY: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
  NONE: 'None',
}
const FIELD_NAME: Record<string, string> = {
  title: 'title',
  statusId: 'status',
  priority: 'priority',
  startDate: 'start date',
  dueDate: 'due date',
  tags: 'tags',
  assigneeIds: 'assignees',
  parentTaskId: 'parent task',
  rank: 'position',
}

function value(field: string, raw: unknown, lookup: NameLookup): string {
  if (raw === null || raw === undefined || raw === '') return 'none'
  switch (field) {
    case 'statusId':
      return typeof raw === 'string'
        ? (lookup.statusName(raw) ?? 'a removed status')
        : 'a removed status'
    case 'assigneeIds': {
      const ids = Array.isArray(raw) ? raw : [raw]
      if (ids.length === 0) return 'none'
      return ids.map((id) => lookup.memberName(String(id)) ?? 'a former member').join(', ')
    }
    case 'startDate':
    case 'dueDate':
      return formatDay(String(raw))
    case 'priority':
      return PRIORITY[String(raw)] ?? String(raw).toLowerCase()
    case 'tags':
      return Array.isArray(raw) ? raw.join(', ') || 'none' : String(raw)
    case 'parentTaskId':
      return 'another task'
    default: {
      const text = String(raw)
      return UUID.test(text) ? 'another item' : text
    }
  }
}

type Changes = Record<string, { from?: unknown; to?: unknown }>

/** The write-time snapshot of one custom field change (AD-7); names and texts, never ids. */
type CustomChange = { field?: string; fromText?: string; toText?: string }

function changesOf(entry: ActivityView): Changes {
  const payload = entry.payload as { changes?: Changes } | null | undefined
  return payload?.changes && typeof payload.changes === 'object' ? payload.changes : {}
}

/** "set <field> to <value>" or "cleared <field>", one per custom field the entry changed. */
function customFieldLines(entry: ActivityView): string[] {
  const raw = changesOf(entry).customFields as unknown
  if (!raw || typeof raw !== 'object') return []
  return Object.values(raw as Record<string, CustomChange>).map((c) => {
    const name = c.field || 'a custom field'
    return c.toText ? `set ${name} to ${c.toText}` : `cleared ${name}`
  })
}

/** Who did it: a service account reads "triage-agent (key CI-1)", never a bare id. */
export function actorLabel(entry: ActivityView): string {
  const name = entry.actorName ?? 'Someone'
  if (entry.actorType === 'SERVICE_ACCOUNT' && entry.actorKeyName) {
    return `${name} (key ${entry.actorKeyName})`
  }
  return name
}

/** One sentence per changed field (a `task.updated` can carry several). */
export function activitySentences(entry: ActivityView, lookup: NameLookup): string[] {
  switch (entry.type) {
    case 'task.created':
      return ['created this task', ...customFieldLines(entry)]
    case 'task.status_changed':
    case 'task.updated': {
      const lines = Object.entries(changesOf(entry))
        .filter(([field]) => field !== 'rank' && field !== 'customFields')
        .map(([field, change]) =>
          field === 'description'
            ? 'changed the description'
            : `changed ${FIELD_NAME[field] ?? 'a field'} from ${value(field, change?.from, lookup)} to ${value(field, change?.to, lookup)}`,
        )
      lines.push(...customFieldLines(entry))
      return lines.length ? lines : ['changed this task']
    }
    case 'task.moved':
      return ['moved this task']
    case 'task.duplicated':
      return ['duplicated this task']
    case 'task.trashed':
      return ['moved this task to trash']
    case 'task.restored':
      return ['restored this task']
    case 'comment.created':
      return ['commented']
    case 'comment.edited':
      return ['edited a comment']
    case 'comment.deleted':
      return ['deleted a comment']
    case 'checklist.changed':
      return ['changed a checklist']
    default:
      return ['changed this task']
  }
}
