const TYPING =
  'input, textarea, select, [contenteditable="true"], [role="combobox"], [data-tf-floating]'

/**
 * True when a key press aimed at `target` belongs to a text field or to a library control (a Select trigger,
 * anything inside a floating layer), so a global shortcut such as `/` must leave it alone (AD-5).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING) !== null
}
