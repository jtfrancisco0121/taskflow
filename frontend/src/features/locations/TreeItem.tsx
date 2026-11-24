import { NavLink, useNavigate, useParams } from 'react-router'
import { useUiStore } from '../../shared/ui-store'
import { LocationIcon, LockMarker } from './LocationIcon'
import { useTreeChildren, type TreeNode } from './useTreeChildren'

type TreeItemProps = {
  workspaceId: string
  node: TreeNode
  level: number
  focusedId: string | null
  onFocusItem: (id: string) => void
}

function focusItem(element: Element | null | undefined) {
  if (element instanceof HTMLElement) element.focus()
}

export function TreeItem({ workspaceId, node, level, focusedId, onFocusItem }: TreeItemProps) {
  const navigate = useNavigate()
  const { locationId } = useParams()
  const id = node.id!
  const expandedIds = useUiStore((state) => state.expanded[workspaceId])
  const setExpanded = useUiStore((state) => state.setExpanded)
  const expandable = node.hasChildren === true
  const expanded = expandable && (expandedIds ?? []).includes(id)
  const children = useTreeChildren(workspaceId, id, expanded)
  const label = `${node.name}${node.isPrivate ? ' (private)' : ''}`

  const open = () => void navigate(`/w/${workspaceId}/l/${id}`)

  function onKeyDown(event: React.KeyboardEvent<HTMLLIElement>) {
    if (event.target !== event.currentTarget) return
    const item = event.currentTarget
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
        open()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <li
      role="treeitem"
      aria-label={label}
      aria-level={level}
      aria-expanded={expandable ? expanded : undefined}
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
        {expandable ? (
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
        <NavLink
          to={`/w/${workspaceId}/l/${id}`}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate"
          onClick={(event) => event.stopPropagation()}
        >
          {node.name}
        </NavLink>
        {node.isPrivate && <LockMarker />}
      </div>
      {expanded && (
        <ul role="group" className="m-0 p-0">
          {children.isPending && (
            <li role="status" className="list-none py-1 pl-8 text-xs text-slate-500">
              Loading…
            </li>
          )}
          {children.isError && (
            <li role="none" className="list-none py-1 pl-8 text-xs text-red-700">
              Couldn&apos;t load.{' '}
              <button type="button" className="underline" onClick={() => void children.refetch()}>
                Retry
              </button>
            </li>
          )}
          {children.data?.map((child) => (
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
    </li>
  )
}
