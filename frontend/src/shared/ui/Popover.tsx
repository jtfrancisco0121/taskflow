import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactElement, ReactNode } from 'react'
import { floatingClass, floatingProps } from './floating'

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
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={label}
          sideOffset={6}
          {...floatingProps}
          className={`${floatingClass} p-3`}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
