import * as MenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ReactElement } from 'react'
import { floatingClass, floatingProps, itemClass, keepFocusIfMoved } from './floating'
import { Kbd } from './Kbd'

export type MenuItem =
  | {
      label: string
      onSelect: () => void
      destructive?: boolean
      disabled?: boolean
      /** A shortcut hint shown on the right, for example "Del". */
      shortcut?: string
    }
  | 'separator'

type DropdownMenuProps = {
  /** One element: it opens the menu. */
  trigger: ReactElement
  items: MenuItem[]
}

/** An action menu: arrow keys, typeahead, Escape; destructive items are shown in the danger colour. */
export function DropdownMenu({ trigger, items }: DropdownMenuProps) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          sideOffset={6}
          align="start"
          {...floatingProps}
          onCloseAutoFocus={keepFocusIfMoved}
          className={`${floatingClass} min-w-40 p-1`}
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <MenuPrimitive.Separator key={`sep-${i}`} className="my-1 h-px bg-line" />
            ) : (
              <MenuPrimitive.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={`${itemClass} ${item.destructive ? 'text-danger' : ''}`}
              >
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              </MenuPrimitive.Item>
            ),
          )}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  )
}
