import { expect, type Locator } from '@playwright/test'

/**
 * The one place e2e specs pick, read and list the options of a select-like control
 * (a native <select> today, a Radix-style trigger with a floating listbox or menu later).
 * Options are always named by their visible label, never by their value, so a spec keeps
 * working when a control is swapped. `{ index: n }` is the documented fallback when an
 * option has no stable name. `optionsOf` and `{ index }` list the options a user can pick (AD-11): a
 * placeholder never counts, and a disabled option never counts. On a native <select> a placeholder is the
 * option with value=""; on the library Select (Radix) it is shown on the trigger and is never an item, while a
 * real "" choice such as "Any status" is an item and is listed. A native select with a real "" choice is not
 * supported: the lint rule bans new native selects, and the two that remain (FilterBuilder, FilterInput) use
 * "" only as a placeholder.
 * ESLint keeps specs from calling `selectOption` or reading `option:checked` directly.
 */
export type Option = string | { index: number }

async function isNativeSelect(control: Locator) {
  // A native <select> also has the implicit role "combobox": check the tag first.
  return (await control.evaluate((el) => el.tagName)) === 'SELECT'
}

/** Opens a trigger and returns the floating listbox or menu it controls. */
export async function open(trigger: Locator): Promise<Locator> {
  // Hold the element itself: while a Radix listbox is open the page behind it is aria-hidden, so a locator
  // that finds the trigger by its <label> (getByLabel) no longer resolves until the popup closes.
  const element = await trigger.elementHandle()
  await trigger.click()
  // The popup is portalled and wired by aria-controls, which is set only while it is open.
  const controls = await trigger
    .page()
    .waitForFunction((el) => el?.getAttribute('aria-controls') || false, element)
  const id = (await controls.jsonValue()) as string
  const popup = trigger.page().locator(`[id="${id}"]`)
  await expect(popup).toBeVisible()
  return popup
}

const itemRole = async (popup: Locator) =>
  (await popup.getAttribute('role')) === 'menu' ? 'menuitem' : 'option'

/** The items a user can pick: a disabled (aria-disabled) item does not count. */
const pickable = (popup: Locator, role: 'menuitem' | 'option') =>
  popup.getByRole(role).and(popup.page().locator(':not([aria-disabled="true"])'))

/** Picks an option by its visible label (or `{ index }`, placeholders not counted). */
export async function pick(control: Locator, option: Option, options?: { timeout?: number }) {
  if (await isNativeSelect(control)) {
    if (typeof option === 'string') {
      await control.selectOption({ label: option }, options)
      return
    }
    const real = await control.evaluate((el, n) => {
      const real = Array.from((el as HTMLSelectElement).options)
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => o.value !== '' && !o.disabled)
      return real[n]?.i ?? -1
    }, option.index)
    expect(real, `no option at index ${option.index}`).toBeGreaterThanOrEqual(0)
    await control.selectOption({ index: real }, options)
    return
  }
  const popup = await open(control)
  const role = await itemRole(popup)
  const items =
    typeof option === 'string'
      ? popup.getByRole(role, { name: option, exact: true })
      : pickable(popup, role).nth(option.index)
  await items.click(options)
}

/** A Locator whose text is the value the control shows, for `toHaveText`. */
export function valueOf(control: Locator): Locator {
  return control.locator('option:checked').or(control.and(control.page().locator(':not(select)')))
}

export async function expectValue(control: Locator, label: string, options?: { timeout?: number }) {
  await expect(valueOf(control)).toHaveText(label, options)
}

/** The visible labels of the control's options, in order. */
export async function optionsOf(control: Locator): Promise<string[]> {
  if (await isNativeSelect(control)) {
    return await control.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options)
        .filter((o) => o.value !== '' && !o.disabled)
        .map((o) => (o.textContent ?? '').trim()),
    )
  }
  const popup = await open(control)
  const role = await itemRole(popup)
  const labels = (await pickable(popup, role).allTextContents()).map((t) => t.trim())
  await control.page().keyboard.press('Escape')
  await expect(popup).toBeHidden()
  return labels
}
