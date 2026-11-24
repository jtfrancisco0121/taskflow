/** Where a view reads: a Location subtree, or the whole Workspace (no `locationId`). */
export type ViewScope = { workspaceId: string; locationId?: string }

export const scopeId = (scope: ViewScope) => scope.locationId ?? 'workspace'

export const DEFAULT_LIST_ID = 'default-list'
export const DEFAULT_BOARD_ID = 'default-board'

/** The URL of a view: stored views by id, Default views by their reserved strings. */
export function viewPath(scope: ViewScope, key: string): string {
  return scope.locationId
    ? `/w/${scope.workspaceId}/l/${scope.locationId}/v/${key}`
    : `/w/${scope.workspaceId}/v/${key}`
}
