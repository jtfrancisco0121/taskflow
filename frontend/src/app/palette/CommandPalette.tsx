import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useSignOut } from '../../features/auth'
import { useLoadedLocations } from '../../features/locations'
import { useOpenTaskHit, useTaskSearch } from '../../features/search'
import { useCanManageServiceAccounts } from '../../features/serviceAccounts'
import { useAllWorkspaces } from '../../features/workspace'
import { useThemeStore } from '../../shared/theme/theme-store'
import { Command, type CommandGroup } from '../../shared/ui/Command'
import { Dialog } from '../../shared/ui/Dialog'
import { Kbd } from '../../shared/ui/Kbd'
import { useUiStore } from '../../shared/ui-store'
import { buildCommands, type PaletteGroup } from './buildCommands'
import { useShortcut } from './useShortcut'

const ORDER: PaletteGroup[] = ['Go to', 'Workspaces', 'Theme', 'Actions']

/** The palette's top-bar trigger label: the platform's key hint. */
export const shortcutHint = () =>
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'

/** AD-3: the Command palette. Mounted by AppShell only, composed from feature exports. */
export function CommandPalette({
  workspaceId,
  locationId,
}: {
  workspaceId: string | undefined
  locationId: string | undefined
}) {
  const open = useUiStore((state) => state.paletteOpen)
  const setOpen = useUiStore((state) => state.setPaletteOpen)
  const togglePalette = useUiStore((state) => state.togglePalette)
  useShortcut(togglePalette)

  // A picked Command runs after the palette is gone, so the focus the palette gives back never wins over
  // the focus the Command sets (the new-Space field, the sidebar toggle).
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (open || !pending.current) return
    const run = pending.current
    pending.current = null
    run()
  }, [open])

  if (!open) return null
  return (
    <Dialog title="Command palette" placement="top" onClose={() => setOpen(false)}>
      <PaletteBody
        workspaceId={workspaceId}
        locationId={locationId}
        choose={(run) => {
          pending.current = run
          setOpen(false)
        }}
      />
    </Dialog>
  )
}

function PaletteBody({
  workspaceId,
  locationId,
  choose,
}: {
  workspaceId: string | undefined
  locationId: string | undefined
  choose: (run: () => void) => void
}) {
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const signOut = useSignOut()
  const themeChoice = useThemeStore((state) => state.choice)
  const setTheme = useThemeStore((state) => state.setChoice)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const setCreatingSpace = useUiStore((state) => state.setCreatingSpace)
  const locations = useLoadedLocations(workspaceId)
  const { workspaces } = useAllWorkspaces()
  const canManageServiceAccounts = useCanManageServiceAccounts(workspaceId)
  const { q, query, hits } = useTaskSearch(workspaceId, search)
  const openTask = useOpenTaskHit()

  const commands = buildCommands({
    workspaceId,
    locationId,
    workspaces: workspaces.flatMap((w) => (w.id ? [{ id: w.id, name: w.name ?? '' }] : [])),
    locations,
    canManageServiceAccounts,
    themeChoice,
    navigate: (path) => void navigate(path),
    setTheme,
    newSpace: () => setCreatingSpace(true),
    toggleSidebar: () => {
      toggleSidebar()
      document.querySelector<HTMLElement>('[aria-label="Toggle sidebar"]')?.focus()
    },
    signOut: () => void signOut(),
  })

  const groups: CommandGroup[] = []
  const typed = search.trim()
  if (workspaceId && typed.length >= 2) {
    const searching = q.length < 2 || query.isFetching
    const status: CommandGroup['status'] = query.isError
      ? { kind: 'error', text: 'Couldn’t search tasks.' }
      : searching && hits.length === 0
        ? { kind: 'loading', text: 'Searching…' }
        : undefined
    groups.push({
      heading: 'Tasks',
      filter: false,
      status,
      items: hits.map((hit) => ({
        value: `task:${hit.taskId}`,
        label: hit.title ?? '',
        lead: hit.readableId,
        detail: hit.listName,
        onSelect: () => choose(() => openTask(hit)),
      })),
    })
  }
  for (const heading of ORDER) {
    const items = commands
      .filter((command) => command.group === heading)
      .map((command) => ({
        value: command.id,
        label: command.label,
        detail: command.detail,
        checked: command.checked,
        onSelect: () => choose(command.run),
      }))
    if (items.length > 0) groups.push({ heading, items })
  }

  return (
    <>
      <Command
        label="Search commands and tasks"
        size="palette"
        placeholder="Type a command or search tasks…"
        emptyText={`No matches for “${typed}”.`}
        search={search}
        onSearchChange={setSearch}
        groups={groups}
      />
      <div className="mt-2 flex gap-3 border-t border-line px-2 pt-2 text-xs text-muted">
        <span>
          <Kbd>↑↓</Kbd> move
        </span>
        <span>
          <Kbd>↵</Kbd> run
        </span>
        <span>
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </>
  )
}
