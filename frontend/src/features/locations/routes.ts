/** Route builders for Locations; the sidebar, menus and the command palette all build the same URLs. */
export const locationPath = (workspaceId: string, locationId: string) =>
  `/w/${workspaceId}/l/${locationId}`
export const automationsPath = (workspaceId: string, locationId: string) =>
  `${locationPath(workspaceId, locationId)}/automations`
