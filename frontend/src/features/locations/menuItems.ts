import type { TreeNode } from './useTreeChildren'

export type MenuAction = 'new-folder' | 'new-list' | 'rename' | 'privacy' | 'move'

type Item = { action: MenuAction; label: string }

/** Items by type (UX): Space cannot move; only Spaces hold Folders; Lists hold no children. */
export function menuItems(node: TreeNode): Item[] {
  const items: Item[] = []
  if (node.type === 'SPACE') items.push({ action: 'new-folder', label: 'New Folder' })
  if (node.type === 'SPACE' || node.type === 'FOLDER') {
    items.push({ action: 'new-list', label: 'New List' })
  }
  items.push({ action: 'rename', label: 'Rename' })
  items.push({
    action: 'privacy',
    label: node.isPrivate ? 'Make public' : 'Make private',
  })
  if (node.type !== 'SPACE') items.push({ action: 'move', label: 'Move' })
  return items
}
