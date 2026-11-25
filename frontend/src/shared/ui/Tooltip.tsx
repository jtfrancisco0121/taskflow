import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactElement } from 'react'
import { floatingClass, floatingProps } from './floating'

type TooltipProps = {
  label: string
  /** One element: it receives the hover and focus handlers. */
  children: ReactElement
  delayDuration?: number
}

/** A short inverted label shown after a delay on hover and on keyboard focus. */
export function Tooltip({ label, children, delayDuration = 400 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            {...floatingProps}
            data-tf-tooltip=""
            className={`${floatingClass} !border-transparent !bg-fg px-2 py-1 text-xs !text-surface`}
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
