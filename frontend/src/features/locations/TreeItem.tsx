import { useRef, useState, type KeyboardEvent } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router'
import { messageOf } from '../../api/errors'
import { useToastStore } from '../../shared/toast-store'
import { useUiStore } from '../../shared/ui-store'
import { InlineNameField } from './InlineNameField'
import { LocationIcon, LockMarker } from './LocationIcon'
import { MoveDialog } from './MoveDialog'
import { type MenuAction } from './menuItems'
import { TreeItemMenu } from './TreeItemMenu'
import { useCreateLocation, useUpdateLocation } from './useLocationMutations'
import { useTreeChildren, type TreeNode } from './useTreeChildren'

type TreeItemProps = {
  workspaceId: string
  node: TreeNode
  level: number
  focusedId: string | null
  onFocusItem: (id: string) => void
}

type Mode =
  null | { kind: 'create'; type: 'FOLDER' | 'LIST' } | { kind: 'rename' } | { kind: 'move' }

function focusItem(element: Element | null | undefined) {
  if (element instanceof HTMLElement) element.focus()
}

export function TreeItem({ workspaceId, node, level, focusedId, onFocusItem }: TreeItemProps) {
  const navigate = useNavigate()
  const { locationId } = useParams()
  const id = node.id!
  const itemRef = useRef<HTMLLIElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  const expandedIds = useUiStore((state) => state.expanded[workspaceId])
  const setExpanded = useUiStore((state) => state.setExpanded)
  const create = useCreateLocation(workspaceId)
  const update = useUpdateLocation(workspaceId)
  const showToast = useToastStore((state) => state.show)

  const expandable = node.hasChildren === true || node.type !== 'LIST'
  const expanded = expandable && (expandedIds ?? []).includes(id)
  const children = useTreeChildren(workspaceId, id, expanded && node.hasChildren === true)
  const label = `${node.name}${node.isPrivate ? ' (private)' : ''}`
  const creating = mode?.kind === 'create' ? mode : null

  function onAction(action: MenuAction) {
    create.reset()
    update.reset()
    if (action === 'new-folder') setMode({ kind: 'create', type: 'FOLDER' })
    else if (action === 'new-list') setMode({ kind: 'create', type: 'LIST' })
    else if (action === 'rename') setMode({ kind: 'rename' })
    else if (action === 'move') setMode({ kind: 'move' })
    else {
      update.mutate(
        { id, parentId: node.parentId, isPrivate: !node.isPrivate },
        { onError: (error) => showToast(messageOf(error), 'error') },
      )
    }
    if (action === 'new-folder' || action === 'new-list') setExpanded(workspaceId, id, true)
  }

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.target !== event.currentTarget) return
    const item = event.currentTarget
    if (event.key === 'F10' && event.shiftKey) {
      setMenuOpen(true)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const tree = item.closest('[role="tree"]')
    const items = tree ? Array.from(tree.querySelectorAll('[role="treeitem"]')) : []
    const index = items.indexOf(item)
    switch (event.key) {
      case 'ArrowDown':
        focusItem(items[index + 1])
        break
      case 'ArrowUp':
        focusItem(items[index - 1])
        break
      case 'Home':
        focusItem(items[0])
        break
      case 'End':
        focusItem(items.at(-1))
        break
      case 'ArrowRight':
        if (!expandable) return
        if (!expanded) setExpanded(workspaceId, id, true)
        else focusItem(item.querySelector(':scope > ul > [role="treeitem"]'))
        break
      case 'ArrowLeft':
        if (expanded) setExpanded(workspaceId, id, false)
        else focusItem(item.parentElement?.closest('[role="treeitem"]'))
        break
      case 'Enter':
        void navigate(`/w/${workspaceId}/l/${id}`)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <li
      ref={itemRef}
      role="treeitem"
      aria-label={label}
      aria-level={level}
      aria-expanded={expandable && node.hasChildren ? expanded : undefined}
      aria-selected={locationId === id}
      data-node-id={id}
      tabIndex={focusedId === id ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusItem(id)
      }}
      onKeyDown={onKeyDown}
      className="list-none outline-none"
    >
      <div
        className={`group flex items-center gap-1 rounded py-1 pr-1 text-sm hover:bg-slate-100 focus-within:bg-slate-100 ${
          locationId === id ? 'bg-blue-50 font-medium' : ''
        }`}
        style={{ paddingLeft: `${(level - 1) * 12 + 4}px` }}
      >
        {node.hasChildren ? (
          <span
            aria-hidden="true"
            onClick={() => setExpanded(workspaceId, id, !expanded)}
            className="w-4 shrink-0 cursor-pointer text-center text-xs text-slate-500"
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-4 shrink-0" aria-hidden="true" />
        )}
        <LocationIcon type={node.type} />
        {mode?.kind === 'rename' ? (
          <div className="min-w-0 flex-1">
            <InlineNameField
              label={`Rename ${node.name}`}
              initial={node.name}
              pending={update.isPending}
              error={update.error}
              onSave={(name) =>
                update.mutate(
                  { id, parentId: node.parentId, name },
                  {
                    onSuccess: () => {
                      setMode(null)
                      focusItem(itemRef.current)
                    },
                  },
                )
              }
              onCancel={() => {
                setMode(null)
                focusItem(itemRef.current)
              }}
            />
          </div>
        ) : (
          <NavLink
            to={`/w/${workspaceId}/l/${id}`}
            tabIndex={-1}
            className="min-w-0 flex-1 truncate"
          >
            {node.name}
          </NavLink>
        )}
        {node.isPrivate && <LockMarker />}
        <TreeItemMenu node={node} open={menuOpen} onOpenChange={setMenuOpen} onAction={onAction} />
      </div>
      {(expanded || creating) && (
        <ul role="group" className="m-0 p-0">
          {creating && (
            <li role="none" className="list-none">
              <InlineNameField
                label={`New ${creating.type === 'FOLDER' ? 'Folder' : 'List'} name`}
                withPrivate
                pending={create.isPending}
                error={create.error}
                onSave={(name, isPrivate) =>
                  create.mutate(
                    { name, type: creating.type, parentId: id, isPrivate },
                    { onSuccess: () => setMode(null) },
                  )
                }
                onCancel={() => {
                  setMode(null)
                  focusItem(itemRef.current)
                }}
              />
            </li>
          )}
          {expanded && children.isPending && node.hasChildren && (
            <li role="status" className="list-none py-1 pl-8 text-xs text-slate-500">
              Loading…
            </li>
          )}
          {expanded && children.isError && (
            <li role="none" className="list-none py-1 pl-8 text-xs text-red-700">
              Couldn&apos;t load.{' '}
              <button type="button" className="underline" onClick={() => void children.refetch()}>
                Retry
              </button>
            </li>
          )}
          {expanded &&
            children.data?.map((child) => (
              <TreeItem
                key={child.id}
                workspaceId={workspaceId}
                node={child}
                level={level + 1}
                focusedId={focusedId}
                onFocusItem={onFocusItem}
              />
            ))}
        </ul>
      )}
      {mode?.kind === 'move' && (
        <MoveDialog
          workspaceId={workspaceId}
          node={node}
          onClose={() => setMode(null)}
          restoreFocus={() => itemRef.current}
        />
      )}
    </li>
  )
}
