import type { Priority, StatusInfo } from '../../api/types'
import { formatDay, toApiDate } from '../../shared/dates'
import { Avatar } from '../../shared/ui/Avatar'
import type { PickerItem } from '../../shared/ui/Picker'
import { PriorityBadge, type PriorityLevel } from '../../shared/ui/PriorityBadge'
import { StatusBadge, type StatusTone } from '../../shared/ui/StatusBadge'
import { PRIORITIES, PRIORITY_LABEL } from './labels'

/**
 * The editor vocabulary of the slice-4 Picker: the status, priority, assignee and day items and the value shown
 * in a trigger. The List rows and the task detail both use these, so no list of items exists twice (AD-3).
 */

const DAY = 86_400_000
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Today, tomorrow and next Monday as UTC `YYYY-MM-DD` days (decision: task dates are UTC days). */
export function quickDays(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const toMonday = (8 - new Date(today).getUTCDay()) % 7 || 7
  return {
    today: utcDay(today),
    tomorrow: utcDay(today + DAY),
    nextWeek: utcDay(today + toMonday * DAY),
  }
}

const TONE: Record<string, StatusTone> = { ACTIVE: 'progress', DONE: 'done', CLOSED: 'done' }
const toneOf = (status: StatusInfo | undefined): StatusTone => TONE[status?.group ?? ''] ?? 'todo'

const LEVEL: Record<string, PriorityLevel> = {
  URGENT: 'urgent',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
}

export type Member = { userId?: string; displayName?: string; email?: string }

export function statusItems(statuses: StatusInfo[]): PickerItem[] {
  return statuses.map((s) => ({
    value: s.id!,
    label: s.name ?? '',
    render: <StatusBadge name={s.name ?? ''} tone={toneOf(s)} />,
  }))
}

export function priorityItems(): PickerItem[] {
  return PRIORITIES.map((p) => ({
    value: p,
    label: LEVEL[p] ? PRIORITY_LABEL[p] : 'None',
    render: LEVEL[p] ? <PriorityBadge name={PRIORITY_LABEL[p]} level={LEVEL[p]} /> : undefined,
  }))
}

export function assigneeItems(members: Member[]): PickerItem[] {
  return members.map((m) => ({
    value: m.userId!,
    label: m.displayName ?? m.email ?? '',
    render: (
      <span className="flex items-center gap-2">
        <Avatar name={m.displayName ?? m.email ?? ''} size={20} />
        {m.displayName ?? m.email}
      </span>
    ),
  }))
}

export function dayItems(days = quickDays()): PickerItem[] {
  return [
    { value: 'today', label: 'Today', hint: days.today },
    { value: 'tomorrow', label: 'Tomorrow', hint: days.tomorrow },
    { value: 'next-week', label: 'Next week', hint: days.nextWeek },
    { value: 'none', label: 'No date' },
  ]
}

/** The API date (or null for "No date") a day item stands for. */
export function dayOfItem(value: string, days = quickDays()): string | null {
  if (value === 'none') return null
  return toApiDate(
    value === 'today' ? days.today : value === 'tomorrow' ? days.tomorrow : days.nextWeek,
  )
}

/** The status in a trigger: its badge, or a dash. */
export function StatusValue({ status }: { status: StatusInfo | undefined }) {
  return status ? <StatusBadge name={status.name ?? ''} tone={toneOf(status)} /> : <>—</>
}

export function PriorityValue({ priority }: { priority: Priority | undefined }) {
  const p = priority ?? 'NONE'
  return LEVEL[p] ? (
    <PriorityBadge name={PRIORITY_LABEL[p]} level={LEVEL[p]} />
  ) : (
    <span className="text-faint">{PRIORITY_LABEL[p]}</span>
  )
}

export function AssigneesValue({ ids, names }: { ids: string[]; names: Map<string, string> }) {
  return ids.length === 0 ? (
    <span className="text-faint">—</span>
  ) : (
    <span className="flex -space-x-1">
      {ids.map((id) => (
        <Avatar key={id} name={names.get(id) ?? 'Former member'} size={20} />
      ))}
    </span>
  )
}

export function DayValue({ iso }: { iso: string | null | undefined }) {
  return iso ? <>{formatDay(iso)}</> : <span className="text-faint">—</span>
}
