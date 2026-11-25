import { waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * The one place component tests pick, read and list the options of a select-like control
 * (a native <select> today, a Radix-style trigger with a floating listbox or menu later).
 * Options are always named by their visible label, never by their value, so a test keeps
 * working when a control is swapped. `{ index: n }` is the documented fallback when an
 * option has no stable name; it counts only real options (a placeholder is skipped).
 * ESLint keeps tests from calling `selectOptions`, `toHaveDisplayValue` or casting to
 * HTMLSelectElement; `toHaveValue` and option queries on a select are kept out by review.
 */
export type Option = string | { index: number }

const isNative = (control: HTMLElement): control is HTMLSelectElement =>
  // A native <select> also has the implicit role "combobox": check the tag first.
  control.tagName === 'SELECT'

const textOf = (el: Element) => (el.textContent ?? '').trim()

/** Real options only: a placeholder (empty value) or a disabled option does not count. */
const realOptions = (select: HTMLSelectElement) =>
  Array.from(select.options).filter((o) => o.value !== '' && !o.disabled)

/** Opens a trigger and returns the floating listbox or menu it controls. */
export async function open(user: UserEvent, trigger: HTMLElement): Promise<HTMLElement> {
  await user.click(trigger)
  // The popup is portalled and wired by aria-controls, which is set only while it is open.
  let popup: HTMLElement | null = null
  await waitFor(() => {
    const id = trigger.getAttribute('aria-controls')
    popup = id ? document.getElementById(id) : null
    expect(popup).not.toBeNull()
  })
  return popup as unknown as HTMLElement
}

const itemRole = (popup: HTMLElement) =>
  popup.getAttribute('role') === 'menu' ? 'menuitem' : 'option'

async function close(user: UserEvent) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(document.querySelector('[role="listbox"],[role="menu"]')).toBeNull())
}

/** Picks an option by its visible label (or `{ index }`, placeholders not counted). */
export async function pick(user: UserEvent, control: HTMLElement, option: Option) {
  if (isNative(control)) {
    const target =
      typeof option === 'string'
        ? Array.from(control.options).find((o) => textOf(o) === option)
        : realOptions(control)[option.index]
    if (!target) {
      throw new Error(
        `no option ${typeof option === 'string' ? `labelled "${option}"` : `at index ${option.index}`}`,
      )
    }
    await user.selectOptions(control, target)
    return
  }
  const popup = await open(user, control)
  const role = itemRole(popup)
  const item =
    typeof option === 'string'
      ? within(popup).getByRole(role, { name: option })
      : within(popup).getAllByRole(role)[option.index]
  await user.click(item)
}

/** The label the control shows. */
export function valueOf(control: HTMLElement): string {
  if (isNative(control)) return textOf(control.selectedOptions[0] ?? control)
  return textOf(control)
}

export function expectValue(control: HTMLElement, label: string) {
  expect(valueOf(control)).toBe(label)
}

/** The visible labels of the control's options, in order. */
export async function optionsOf(user: UserEvent, control: HTMLElement): Promise<string[]> {
  if (isNative(control)) return Array.from(control.options).map(textOf)
  const popup = await open(user, control)
  const labels = within(popup).getAllByRole(itemRole(popup)).map(textOf)
  await close(user)
  return labels
}

/** Waits until the control offers an option with this label, and returns its label. */
export async function findOption(
  user: UserEvent,
  control: HTMLElement,
  label: string,
): Promise<string> {
  if (isNative(control)) return textOf(await within(control).findByRole('option', { name: label }))
  const popup = await open(user, control)
  const found = textOf(await within(popup).findByRole(itemRole(popup), { name: label }))
  await close(user)
  return found
}
