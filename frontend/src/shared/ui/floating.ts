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

// Skips aria-hidden and tabindex=-1 elements (AD-12): Radix renders a hidden form <select> next to its trigger.
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([aria-hidden="true"]):not([tabindex="-1"])`)
  .join(',')

/**
 * `onCloseAutoFocus` for floating content. Radix gives focus back to the trigger a moment after the layer
 * closes. When the pick opened something that took focus meanwhile (a confirmation Dialog), that would steal
 * the focus from it, so the return is skipped when focus is already on a real element outside the layer.
 */
export function keepFocusIfMoved(event: Event) {
  const active = document.activeElement
  // A modal Radix menu traps focus while it is still mounted, so a Dialog opened by a pick may have been
  // pulled back to the body: give the focus to that Dialog instead of the trigger.
  if (!active || active === document.body) {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
    if (dialog) {
      event.preventDefault()
      ;(dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus()
      return
    }
  }
  if (active && active !== document.body && !active.closest('[data-tf-floating]')) {
    event.preventDefault()
  }
}

/**
 * True while a floating layer that traps focus or takes the pointer is open: any `[data-tf-floating]` element
 * except a tooltip and the command palette's own panel, or focus inside one. The palette shortcut stays quiet
 * then, so it never opens under a modal menu, a Select or a popover (AD-5).
 */
export function hasOpenFloatingLayer(): boolean {
  const layer = '[data-tf-floating]:not([data-tf-tooltip]):not([data-tf-palette])'
  if (document.querySelector(layer)) return true
  const active = document.activeElement
  return !!active && active.closest(layer) !== null
}
