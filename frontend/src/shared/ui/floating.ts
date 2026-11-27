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
 * A floating layer that can still hold focus while it closes. The command palette is marked floating too, but it
 * is a Dialog of its own: focus in it has moved out of the closing layer (AD-5).
 */
const CLOSING_LAYER = '[data-tf-floating]:not([data-tf-palette])'

/**
 * `onCloseAutoFocus` for floating content. Radix gives focus back to the trigger a moment after the layer
 * closes. When the pick opened something that took focus meanwhile (a confirmation Dialog, or the command palette
 * opened by Ctrl/Cmd+K in that moment), that would steal the focus from it, so the return is skipped when focus is
 * already on a real element outside the layer.
 */
export function keepFocusIfMoved(event: Event) {
  const active = document.activeElement
  if (active && active !== document.body && !active.closest(CLOSING_LAYER)) {
    event.preventDefault()
  }
}

const MODAL = '[role="dialog"][aria-modal="true"]'

/**
 * `onCloseAutoFocus` for a menu whose pick can open a Dialog. A modal Radix menu traps focus while it is still
 * mounted, so a Dialog opened by a pick may have been pulled back to the body: give the focus to the topmost
 * Dialog instead of the trigger. Only for such menus: a Select or popover inside a Dialog closes with focus on
 * the body too, and must give focus back to its own trigger, never to the Dialog's first field.
 *
 * `trigger` is the menu's own trigger. When it sits inside the topmost modal Dialog and focus fell to the body
 * (or stayed in the menu), the pick opened nothing above it: Radix returns focus to the trigger, not to the
 * Dialog's first field (slice-3 carry-over, AD-8).
 */
export function keepFocusOrEnterDialog(event: Event, trigger?: Element | null) {
  const active = document.activeElement
  if (!active || active === document.body || active.closest(CLOSING_LAYER)) {
    const dialogs = document.querySelectorAll<HTMLElement>(MODAL)
    const dialog = dialogs[dialogs.length - 1]
    if (dialog) {
      if (trigger && dialog.contains(trigger)) return
      if (!active || active === document.body) {
        event.preventDefault()
        ;(dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus()
        return
      }
    }
  }
  keepFocusIfMoved(event)
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
