import { expect, test } from '@playwright/test'
import { expectNoContrastViolations, tokenOf, watchFontRequests } from './a11y'
import { snap } from './screenshots'

// CAP-7, CAP-2, CAP-3 (slice 2): /design shows every library component, the Light / Aurora / System toggle
// switches the theme at once, and both themes (and System-dark) pass the axe color-contrast rule.

const THEMES = [
  { name: 'Light', file: 'light', attr: 'light' },
  { name: 'Aurora', file: 'dark', attr: 'dark' },
] as const

for (const theme of THEMES) {
  test(`/design in the ${theme.file} theme has no contrast violations`, async ({
    page,
  }, testInfo) => {
    const fonts = watchFontRequests(page)
    await page.goto('/design')
    await page.getByRole('button', { name: theme.name, exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.attr)
    await expect(page.getByRole('heading', { name: 'Buttons', exact: true })).toBeVisible()
    await snap(page, testInfo, `design-${theme.file}`)
    await expectNoContrastViolations(page, `/design ${theme.file}`)
    fonts.expectNone()
  })
}

test('/design System follows the OS scheme and matches Aurora', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/design')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  const system = await tokenOf(page, '--tf-bg')
  await page.getByRole('button', { name: 'Aurora', exact: true }).click()
  expect(await tokenOf(page, '--tf-bg')).toBe(system)
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  expect(await tokenOf(page, '--tf-bg')).not.toBe(system)
  await page.getByRole('button', { name: 'System', exact: true }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  expect(await tokenOf(page, '--tf-bg')).toBe(system)
  await expectNoContrastViolations(page, '/design System-dark')
})

test('/design: a Select inside the open Dialog is themed, above it, and Escape closes one layer at a time', async ({
  page,
}) => {
  await page.goto('/design')
  await page.getByRole('button', { name: 'Aurora', exact: true }).click()
  await page.getByRole('button', { name: 'Open dialog' }).click()
  const dialog = page.getByRole('dialog', { name: 'Example dialog' })
  await dialog.getByLabel('Status in dialog').click()
  const listbox = page
    .getByRole('listbox')
    .filter({ has: page.getByRole('option', { name: 'In progress' }) })
  await expect(listbox).toBeVisible()
  // No full-page screenshot here: it resizes the viewport, which closes an open Select.
  await expectNoContrastViolations(page, '/design dialog with open Select')
  await page.keyboard.press('Escape')
  await expect(listbox).toBeHidden()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
