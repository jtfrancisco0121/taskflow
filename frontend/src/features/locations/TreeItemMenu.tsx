import { useEffect, useRef } from 'react'
import { menuItems, type MenuAction } from './menuItems'
import type { TreeNode } from './useTreeChildren'

type TreeItemMenuProps = {
  node: TreeNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (action: MenuAction) => void
}

export function TreeItemMenu({ node, open, onOpenChange, onAction }: TreeItemMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const items = menuItems(node)

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Actions for ${node.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
          onOpenChange(!open)
        }}
        className="rounded px-1 text-slate-500 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-slate-200 focus:opacity-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`${node.name} actions`}
          onKeyDown={(event) => {
            const buttons = Array.from(
              rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
            )
            const index = buttons.indexOf(document.activeElement as HTMLElement)
            if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus()
            else if (event.key === 'ArrowUp') {
              buttons[(index - 1 + buttons.length) % buttons.length]?.focus()
            } else if (event.key === 'Escape') onOpenChange(false)
            else return
            event.preventDefault()
            event.stopPropagation()
          }}
          className="absolute right-0 z-20 mt-1 w-44 rounded border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation()
                onOpenChange(false)
                onAction(item.action)
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 focus:bg-slate-100"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
