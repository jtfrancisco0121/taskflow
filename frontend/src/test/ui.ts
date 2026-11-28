import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

/**
 * The one place component tests pick, read and list the options of a select-like control
 * (a native <select> today, a Radix-style trigger with a floating listbox or menu later).
 * Options are always named by their visible label, never by their value, so a test keeps
 * working when a control is swapped. `{ index: n }` is the documented fallback when an
 * option has no stable name. `optionsOf` and `{ index }` list the options a user can pick (AD-11):
 * a placeholder never counts, and a disabled option never counts. On a native <select> a placeholder is the
 * option with value=""; on the library Select (Radix) it is shown on the trigger and is never an item, while a
 * real "" choice such as "Any status" is an item and is listed. A native select with a real "" choice is not
 * supported: the lint rule bans native selects everywhere.
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

/**
 * Opens a trigger and returns the floating listbox, menu or popover it controls. A trigger that is already
 * open (`aria-expanded="true"`, for example a multi-mode Picker after a pick) is not clicked again: a second
 * click would close it, so two picks in a row on a multi Picker both land.
 */
export async function open(user: UserEvent, trigger: HTMLElement): Promise<HTMLElement> {
  if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger)
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

/** The items a user can pick: a disabled (aria-disabled) item does not count. */
const pickable = (popup: HTMLElement) =>
  within(popup)
    .getAllByRole(itemRole(popup))
    .filter((item) => item.getAttribute('aria-disabled') !== 'true')

/** Closes the popup this call opened and waits for that element to leave the DOM, not for every popup. */
async function close(user: UserEvent, popup: HTMLElement) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(popup.isConnected).toBe(false))
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
      : pickable(popup)[option.index]
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
  if (isNative(control)) return realOptions(control).map(textOf)
  const popup = await open(user, control)
  const labels = pickable(popup).map(textOf)
  await close(user, popup)
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
  await close(user, popup)
  return found
}

/** The open task detail by its name, in either frame: the modal dialog or the docked complementary panel. */
export const queryTaskDetail = (name: string | RegExp): HTMLElement | null =>
  screen.queryByRole('dialog', { name }) ?? screen.queryByRole('complementary', { name })

export async function findTaskDetail(name: string | RegExp): Promise<HTMLElement> {
  let found: HTMLElement | null = null
  await waitFor(() => {
    found = queryTaskDetail(name)
    expect(found).not.toBeNull()
  })
  return found as unknown as HTMLElement
}

/**
 * Puts text that is only data into a field in one input event: focus, then paste (14yq6g333cc). user.type sends a
 * keydown/input/keyup chain and a React render per character, so typing whole words spent most of a test's 5 s budget
 * and timed out on a loaded machine. Keep user.type for short input, special keys ({Enter}, {Escape}) and tests about
 * keystrokes; the lint rule in eslint.config.js points long typed strings here.
 */
export async function fill(user: UserEvent, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}
