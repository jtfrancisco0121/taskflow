/** AD-4: every query key comes from here; mutations invalidate through the same factory. */
export const queryKeys = {
  me: () => ['me'] as const,
  workspaces: () => ['workspaces'] as const,
  members: (wsId: string) => ['ws', wsId, 'members'] as const,
  tree: (wsId: string, parentId: string | 'root') => ['ws', wsId, 'tree', parentId] as const,
  treeAll: (wsId: string) => ['ws', wsId, 'tree'] as const,
  location: (locationId: string) => ['location', locationId] as const,
  /** Custom fields of a location: under ['location', id] so a location event refreshes them (AD-12). */
  fields: (locationId: string) => ['location', locationId, 'fields'] as const,
  statuses: (wsId: string, locationId: string) => ['ws', wsId, 'statuses', locationId] as const,
  statusesAll: (wsId: string) => ['ws', wsId, 'statuses'] as const,
  tasks: (wsId: string, locationId: string) => ['ws', wsId, 'tasks', locationId] as const,
  tasksAll: (wsId: string) => ['ws', wsId, 'tasks'] as const,
  /** AD-19: one key per (Workspace, scope, config hash, group value). */
  view: (wsId: string, scopeId: string, configHash: string, groupValue?: string) =>
    ['ws', wsId, 'view', scopeId, configHash, groupValue ?? null] as const,
  viewsAll: (wsId: string) => ['ws', wsId, 'view'] as const,
  viewList: (wsId: string, scopeId: string) => ['ws', wsId, 'viewList', scopeId] as const,
  viewListAll: (wsId: string) => ['ws', wsId, 'viewList'] as const,
  search: (wsId: string, q: string) => ['ws', wsId, 'search', q] as const,
  /** Agent access (SA-1..4, KEY-1..7): every key starts with the Workspace, so one prefix clears it. */
  serviceAccountsAll: (wsId: string) => ['ws', wsId, 'serviceAccounts'] as const,
  serviceAccounts: (wsId: string) => ['ws', wsId, 'serviceAccounts', 'list'] as const,
  serviceAccount: (wsId: string, id: string) => ['ws', wsId, 'serviceAccounts', id] as const,
  apiKeys: (wsId: string, id: string) => ['ws', wsId, 'serviceAccounts', id, 'keys'] as const,
  saAudit: (wsId: string, id: string) => ['ws', wsId, 'serviceAccounts', id, 'audit'] as const,
  saActivity: (wsId: string, id: string) =>
    ['ws', wsId, 'serviceAccounts', id, 'activity'] as const,
  /** Automation rules of a location (own and inherited), under ['location', id] so a location event refreshes them. */
  automations: (locationId: string) => ['location', locationId, 'automations'] as const,
  automationRuns: (ruleId: string) => ['automation', ruleId, 'runs'] as const,
  /** Who watches a task, under ['task', id] so a task refresh reaches it. */
  watchers: (taskId: string) => ['task', taskId, 'watchers'] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskAll: () => ['task'] as const,
  comments: (taskId: string) => ['task', taskId, 'comments'] as const,
  activity: (taskId: string) => ['task', taskId, 'activity'] as const,
  /** DEP: a task's relationships, under ['task', id] so a task refresh reaches them too. */
  dependencies: (taskId: string) => ['task', taskId, 'dependencies'] as const,
}
