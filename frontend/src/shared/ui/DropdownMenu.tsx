import * as MenuPrimitive from '@radix-ui/react-dropdown-menu'
import { useRef, type ReactElement, type ReactNode } from 'react'
import { floatingClass, floatingProps, itemClass, keepFocusOrEnterDialog } from './floating'
import { Kbd } from './Kbd'

export type MenuItem =
  | {
      type?: 'item'
      label: string
      onSelect: () => void
      destructive?: boolean
      disabled?: boolean
      /** A shortcut hint shown on the right, for example "Del". */
      shortcut?: string
      /** Keep the menu open after the pick (for example "Show more"). */
      keepOpen?: boolean
    }
  | {
      /** A choice among siblings, rendered as a `menuitemradio`. */
      type: 'radio'
      label: string
      checked: boolean
      onSelect: () => void
      /** Secondary text shown on the right, for example a role. */
      detail?: string
    }
  | 'separator'

type DropdownMenuProps = {
  /** One element: it opens the menu. */
  trigger: ReactElement
  items: MenuItem[]
  /** Controlled open state; uncontrolled when absent. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The accessible name of the menu (defaults to the trigger). */
  label?: string
  /** Non-item content above the items, for example an error line. */
  header?: ReactNode
  /** Replaces the default focus return on close, so a caller can send focus elsewhere. */
  onCloseAutoFocus?: (event: Event) => void
}

function dropLabelledBy(node: HTMLDivElement | null) {
  node?.removeAttribute('aria-labelledby')
}

/** An action menu: arrow keys, typeahead, Escape; destructive items are shown in the danger colour. */
export function DropdownMenu({
  trigger,
  items,
  open,
  onOpenChange,
  label,
  header,
  onCloseAutoFocus,
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <MenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <MenuPrimitive.Trigger asChild ref={triggerRef}>
        {trigger}
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          sideOffset={6}
          align="start"
          aria-label={label}
          // Radix names the menu by its trigger; an explicit label must win.
          ref={label ? dropLabelledBy : undefined}
          {...floatingProps}
          onCloseAutoFocus={
            onCloseAutoFocus ?? ((event) => keepFocusOrEnterDialog(event, triggerRef.current))
          }
          className={`${floatingClass} min-w-40 p-1`}
        >
          {header}
          {items.map((item, i) =>
            item === 'separator' ? (
              <MenuPrimitive.Separator key={`sep-${i}`} className="my-1 h-px bg-line" />
            ) : item.type === 'radio' ? (
              <MenuPrimitive.RadioGroup key={`radio-${i}`} value={item.checked ? 'on' : ''}>
                <MenuPrimitive.RadioItem
                  value="on"
                  onSelect={item.onSelect}
                  className={`${itemClass} justify-between`}
                >
                  <span className="flex-1">
                    {item.checked ? '✓ ' : ''}
                    {item.label}
                  </span>
                  {item.detail && <span className="text-xs text-muted">{item.detail}</span>}
                </MenuPrimitive.RadioItem>
              </MenuPrimitive.RadioGroup>
            ) : (
              <MenuPrimitive.Item
                key={`item-${i}-${item.label}`}
                disabled={item.disabled}
                onSelect={(event) => {
                  if (item.keepOpen) event.preventDefault()
                  item.onSelect()
                }}
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
