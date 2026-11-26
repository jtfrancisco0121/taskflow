import { hasOpenFloatingLayer } from './floating'
import { isTypingTarget } from './typing'

type GuardOptions = {
  /** `true` for a shortcut that works while a text field has focus (Cmd/Ctrl+K). */
  allowInTextFields?: boolean
  /** `false` for a shortcut that is itself a modifier combination (Cmd/Ctrl+K). */
  singleKey?: boolean
}

/**
 * AD-2: the one "the user is busy" check for every keyboard shortcut. True (do nothing, no preventDefault)
 * while a modal dialog other than the palette is open, while a floating layer is open, while focus is in a
 * text field or library control (unless `allowInTextFields`), or, for a single-key shortcut, while Ctrl, Cmd
 * or Alt is held (a browser or OS combination, not ours).
 */
export function isShortcutBlocked(
  event:
    | KeyboardEvent
    | { target: EventTarget | null; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  { allowInTextFields = false, singleKey = true }: GuardOptions = {},
): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-tf-palette])'))
    return true
  if (hasOpenFloatingLayer()) return true
  if (!allowInTextFields && isTypingTarget(event.target)) return true
  if (singleKey && (event.ctrlKey || event.metaKey || event.altKey)) return true
  return false
}
