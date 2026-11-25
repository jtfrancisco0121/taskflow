import type { SyntheticEvent } from 'react'

const stop = (event: SyntheticEvent) => event.stopPropagation()

/**
 * Props for the content root of every floating layer (Select, Popover, DropdownMenu, Command, Tooltip) (AD-12).
 * React portal events bubble through the React tree to every ancestor handler, so the content root stops them
 * after its own items have handled them. Radix closes on Escape and outside clicks through document
 * listeners, which this does not touch.
 */
export const floatingProps = {
  'data-tf-floating': '',
  onClick: stop,
  onPointerDown: stop,
  onMouseDown: stop,
  onKeyDown: stop,
} as const

/** The look shared by floating layers: the one glass utility, token colours, the floating z-index. */
export const floatingClass = 'glass z-(--tf-z-floating) rounded-lg text-[13px] text-fg'

export const itemClass =
  'relative flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-fg outline-none select-none data-[highlighted]:bg-accent-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'
