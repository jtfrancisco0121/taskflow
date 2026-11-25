import { expect, test, type Page } from '@playwright/test'
import { expectValue, open, optionsOf, pick, valueOf } from './ui'

// Fixtures only: no backend, no app. They prove the helper on a native <select> and on an
// ARIA combobox shaped like Radix Select (a trigger, a portalled listbox wired by
// aria-controls that exists only while open).

const NATIVE = `
  <label for="n">Action type</label>
  <select id="n">
    <option value="">Choose an action</option>
    <option value="ASSIGN">Assign to</option>
    <option value="CHANGE_STATUS">Change status</option>
  </select>`

const COMBOBOX = `
  <button id="t" role="combobox" aria-label="Action type" aria-expanded="false" aria-haspopup="listbox">Choose an action</button>
  <script>
    const trigger = document.getElementById('t')
    const items = [['ASSIGN', 'Assign to'], ['CHANGE_STATUS', 'Change status']]
    function close() {
      document.getElementById('popup')?.remove()
      trigger.removeAttribute('aria-controls')
      trigger.setAttribute('aria-expanded', 'false')
    }
    trigger.addEventListener('click', () => {
      if (document.getElementById('popup')) return close()
      const popup = document.createElement('div')
      popup.id = 'popup'
      popup.setAttribute('role', 'listbox')
      for (const [value, label] of items) {
        const o = document.createElement('div')
        o.setAttribute('role', 'option')
        o.dataset.value = value
        o.textContent = label
        o.addEventListener('click', () => { trigger.textContent = label; close() })
        popup.append(o)
      }
      document.body.append(popup)
      trigger.setAttribute('aria-controls', 'popup')
      trigger.setAttribute('aria-expanded', 'true')
    })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
  </script>`

async function load(page: Page, html: string) {
  await page.setContent(`<!doctype html><body>${html}</body>`)
  return page.getByLabel('Action type')
}

test.describe('native select', () => {
  test('picks by label, by index (placeholder skipped), reads and lists', async ({ page }) => {
    const control = await load(page, NATIVE)
    await expectValue(control, 'Choose an action')
    await pick(control, 'Assign to')
    await expectValue(control, 'Assign to')
    await expect(valueOf(control)).toHaveText('Assign to')
    await pick(control, { index: 1 })
    await expectValue(control, 'Change status')
    await pick(control, { index: 0 })
    await expectValue(control, 'Assign to')
    expect(await optionsOf(control)).toEqual(['Choose an action', 'Assign to', 'Change status'])
  })

  test('a value instead of a label throws', async ({ page }) => {
    const control = await load(page, NATIVE)
    await expect(pick(control, 'ASSIGN', { timeout: 500 })).rejects.toThrow()
  })
})

test.describe('combobox trigger', () => {
  test('opens, picks by label and by index, reads and lists', async ({ page }) => {
    const control = await load(page, COMBOBOX)
    await expectValue(control, 'Choose an action')
    const popup = await open(control)
    await expect(popup.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()

    await pick(control, 'Change status')
    await expectValue(control, 'Change status')
    await pick(control, { index: 0 })
    await expectValue(control, 'Assign to')
    expect(await optionsOf(control)).toEqual(['Assign to', 'Change status'])
    await expect(page.getByRole('listbox')).toHaveCount(0)
  })

  test('a value instead of a label throws', async ({ page }) => {
    const control = await load(page, COMBOBOX)
    await expect(pick(control, 'ASSIGN', { timeout: 500 })).rejects.toThrow()
  })
})
