import type { AccountActivity } from '../../api/types'

const KNOWN: Record<string, string> = {
  'task.created': 'created a task',
  'task.updated': 'updated a task',
  'task.status_changed': 'changed the status of a task',
  'task.moved': 'moved a task',
  'task.duplicated': 'duplicated a task',
  'task.trashed': 'moved a task to the trash',
  'task.restored': 'restored a task',
  'comment.created': 'commented on a task',
  'comment.edited': 'edited a comment',
  'comment.deleted': 'deleted a comment',
  'checklist.changed': 'changed a checklist',
  'location.created': 'created a location',
  'location.renamed': 'renamed a location',
  'location.moved': 'moved a location',
  'location.archived': 'archived a location',
  'location.unarchived': 'unarchived a location',
  'location.deleted': 'deleted a location',
  'location.privacy_changed': 'changed the privacy of a location',
  'grant.created': 'shared a private location',
  'grant.removed': 'removed access to a private location',
  'member.joined': 'added a member',
  'member.removed': 'removed a member',
  'member.role_changed': 'changed a member role',
  'invite.created': 'invited someone',
  'invite.revoked': 'revoked an invite',
  'workspace.renamed': 'renamed the Workspace',
}

/** One line for a recent change: a known type reads as a sentence, anything else is humanised. */
export function changeSentence(entry: AccountActivity): string {
  const type = entry.type ?? ''
  const known = KNOWN[type]
  if (known) return known
  const [entity = 'item', action = 'changed'] = type.split('.')
  return `${action.replace(/_/g, ' ')} (${entity.replace(/_/g, ' ')})`
}

/** Only a live task can be opened: trashed tasks get a Restore action and other entities none. */
export function linkedTaskId(entry: AccountActivity): string | undefined {
  return entry.entity === 'task' && entry.type !== 'task.trashed' ? entry.entityId : undefined
}

/** The version `POST /tasks/{id}/restore` wants in If-Match: the payload of the trash event. */
export function trashedVersion(entry: AccountActivity): number | undefined {
  const payload = entry.payload as { version?: unknown } | null | undefined
  return typeof payload?.version === 'number' ? payload.version : undefined
}
