import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useRef, type ReactElement, type ReactNode } from 'react'
import { floatingClass, floatingProps, keepFocusIfMoved } from './floating'

type PopoverProps = {
  /** One element: it opens and closes the popover. */
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** The accessible name of the floating panel. */
  label: string
}

/** A floating panel anchored to its trigger. */
export function Popover({ trigger, children, open, onOpenChange, label }: PopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild ref={triggerRef}>
        {trigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={label}
          sideOffset={6}
          {...floatingProps}
          onCloseAutoFocus={(event) => keepFocusIfMoved(event, triggerRef.current)}
          className={`${floatingClass} p-3`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
