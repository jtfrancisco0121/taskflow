import { DropdownMenu } from '../../shared/ui/DropdownMenu'
import { keepFocusIfMoved } from '../../shared/ui/floating'
import { menuItems, type MenuAction } from './menuItems'
import type { TreeNode } from './useTreeChildren'

type TreeItemMenuProps = {
  node: TreeNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: MenuAction) => void
  /** Where focus goes when the menu closes (the treeitem; the trigger is hidden and not tabbable). */
  returnFocusTo: () => HTMLElement | null
}

export function TreeItemMenu({
  node,
  open,
  onOpenChange,
  onAction,
  returnFocusTo,
}: TreeItemMenuProps) {
  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
      label={`${node.name} actions`}
      onCloseAutoFocus={(event) => {
        keepFocusIfMoved(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        returnFocusTo()?.focus()
      }}
      trigger={
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          className="rounded px-1 text-faint opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-surface-2 focus:opacity-100"
        >
          ⋯
        </button>
      }
      items={menuItems(node).map((item) => ({
        label: item.label,
        onSelect: () => onAction(item.action),
      }))}
    />
  )
}
