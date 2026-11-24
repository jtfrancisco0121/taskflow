import { json } from '../../test/api'

/** Fixtures shared by the view tests. */
export const task = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `t${n}`,
  workspaceId: 'w1',
  listId: 'l1',
  number: n,
  readableId: `ACME-${n}`,
  title: `Task ${n}`,
  statusId: 'st-todo',
  priority: 'NORMAL',
  assigneeIds: [] as string[],
  tags: [] as string[],
  version: 1,
  dueDate: null,
  ...extra,
})

export const statuses = {
  statuses: [
    { id: 'st-todo', name: 'To do', color: '#94a3b8', group: 'NOT_STARTED' },
    { id: 'st-doing', name: 'In progress', color: '#3b82f6', group: 'ACTIVE' },
    { id: 'st-done', name: 'Done', color: '#22c55e', group: 'DONE' },
  ],
}

export const members = {
  items: [
    { userId: 'u1', displayName: 'Maya Lopez', role: 'OWNER' },
    { userId: 'u2', displayName: 'Omar Haddad', role: 'MEMBER' },
  ],
}

export const baseRoutes = {
  'GET /api/v1/workspaces/:id/members': members,
  'GET /api/v1/locations/:id/statuses': json(statuses),
  'GET /api/v1/locations/:id': { id: 'l1', name: 'Launch', type: 'LIST', workspaceId: 'w1' },
}

export const scope = { workspaceId: 'w1', locationId: 'l1' }
