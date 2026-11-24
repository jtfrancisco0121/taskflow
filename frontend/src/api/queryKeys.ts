/** AD-4: every query key comes from here; mutations invalidate through the same factory. */
export const queryKeys = {
  me: () => ['me'] as const,
  workspaces: () => ['workspaces'] as const,
  members: (wsId: string) => ['ws', wsId, 'members'] as const,
  tree: (wsId: string, parentId: string | 'root') => ['ws', wsId, 'tree', parentId] as const,
  treeAll: (wsId: string) => ['ws', wsId, 'tree'] as const,
  location: (locationId: string) => ['location', locationId] as const,
  statuses: (wsId: string, locationId: string) => ['ws', wsId, 'statuses', locationId] as const,
  statusesAll: (wsId: string) => ['ws', wsId, 'statuses'] as const,
  tasks: (wsId: string, locationId: string) => ['ws', wsId, 'tasks', locationId] as const,
  tasksAll: (wsId: string) => ['ws', wsId, 'tasks'] as const,
  task: (taskId: string) => ['task', taskId] as const,
  taskAll: () => ['task'] as const,
  comments: (taskId: string) => ['task', taskId, 'comments'] as const,
  activity: (taskId: string) => ['task', taskId, 'activity'] as const,
}
