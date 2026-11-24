import type { NotificationView } from '../../api/types'

/** One sentence per kind (catalogs.md), actor first; a rule's message is shown as written. */
export function notificationText(n: NotificationView): string {
  const who = n.actorName ?? 'Someone'
  const task = `${n.taskReadableId ?? ''} ${n.taskTitle ?? ''}`.trim()
  switch (n.kind) {
    case 'ASSIGNED':
      return `${who} assigned you to ${task}`
    case 'MENTIONED':
      return `${who} mentioned you in ${task}`
    case 'COMMENTED':
      return `${who} commented on ${task}`
    case 'STATUS_CHANGED':
      return `${who} changed the status of ${task}`
    case 'DUE_SOON':
      return `${task} is due soon`
    case 'BLOCKER_RESOLVED':
      return `${task} is no longer blocked`
    case 'AUTOMATION':
      return `${n.message ?? 'Automation'} (${task})`
    default:
      return task
  }
}
