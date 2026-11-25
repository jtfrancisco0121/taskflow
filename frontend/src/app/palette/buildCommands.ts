import type { TreeNode } from '../../features/locations'
import { automationsPath, locationPath } from '../../features/locations'
import { inboxPath, notificationSettingsPath } from '../../features/notifications'
import { serviceAccountsPath } from '../../features/serviceAccounts'
import { workspacePath } from '../../features/workspace'
import type { ThemeChoice } from '../../shared/theme/theme-store'

export type PaletteGroup = 'Go to' | 'Workspaces' | 'Theme' | 'Actions'

/** One Command (EXPERIENCE): one group, one label, an id `<group>:<target>` and an action. */
export type PaletteCommand = {
  id: string
  group: PaletteGroup
  label: string
  /** Muted text at the right, for example the kind of a Location. */
  detail?: string
  checked?: boolean
  /** The route a navigation Command goes to (the same builder as its sidebar or menu entry). */
  path?: string
  run: () => void
}

export type PaletteContext = {
  workspaceId: string | undefined
  /** The Location of the current route, if any. */
  locationId: string | undefined
  workspaces: { id: string; name: string }[]
  locations: TreeNode[]
  canManageServiceAccounts: boolean
  themeChoice: ThemeChoice
  navigate: (path: string) => void
  setTheme: (choice: ThemeChoice) => void
  newSpace: () => void
  toggleSidebar: () => void
  signOut: () => void
}

const KIND = { SPACE: 'Space', FOLDER: 'Folder', LIST: 'List' } as const
const THEMES: { choice: ThemeChoice; label: string }[] = [
  { choice: 'light', label: 'Light' },
  { choice: 'dark', label: 'Aurora' },
  { choice: 'system', label: 'System' },
]

/** The static Commands for the current context; a Command whose target is not allowed is not listed. */
export function buildCommands(ctx: PaletteContext): PaletteCommand[] {
  const out: PaletteCommand[] = []
  const go = (id: string, label: string, path: string, detail?: string) =>
    out.push({
      id: `go:${id}`,
      group: 'Go to',
      label,
      detail,
      path,
      run: () => ctx.navigate(path),
    })
  const ws = ctx.workspaceId
  if (ws) {
    go('inbox', 'Go to Inbox', inboxPath(ws))
    go('notification-settings', 'Go to notification settings', notificationSettingsPath(ws))
    if (ctx.canManageServiceAccounts) {
      go('service-accounts', 'Go to service accounts', serviceAccountsPath(ws))
    }
    const here = ctx.locations.find((node) => node.id === ctx.locationId)
    if (ctx.locationId && here?.type === 'LIST') {
      go('automations', 'Go to automations', automationsPath(ws, ctx.locationId))
    }
    for (const node of ctx.locations) {
      if (!node.id || !node.name) continue
      go(
        `location:${node.id}`,
        `Go to ${node.name}`,
        locationPath(ws, node.id),
        node.type ? KIND[node.type] : undefined,
      )
    }
  }
  const others = ctx.workspaces.filter((workspace) => workspace.id !== ws)
  if (ctx.workspaces.length > 1) {
    for (const workspace of others) {
      const path = workspacePath(workspace.id)
      out.push({
        id: `workspace:${workspace.id}`,
        group: 'Workspaces',
        label: `Switch to ${workspace.name}`,
        path,
        run: () => ctx.navigate(path),
      })
    }
  }
  for (const { choice, label } of THEMES) {
    out.push({
      id: `theme:${choice}`,
      group: 'Theme',
      label: `Theme: ${label}`,
      checked: ctx.themeChoice === choice,
      run: () => ctx.setTheme(choice),
    })
  }
  if (ws)
    out.push({ id: 'action:new-space', group: 'Actions', label: 'New Space', run: ctx.newSpace })
  out.push(
    {
      id: 'action:toggle-sidebar',
      group: 'Actions',
      label: 'Toggle sidebar',
      run: ctx.toggleSidebar,
    },
    { id: 'action:sign-out', group: 'Actions', label: 'Sign out', run: ctx.signOut },
  )
  return out
}
