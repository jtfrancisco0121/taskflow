import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/**
 * AD-9: runs axe's color-contrast rule on the current page and fails on any violation. Pass `include` to scan
 * one region only (an open dialog, a toast). A failure is fixed in tokens.css or legacy-bridge.css.
 */
export async function expectNoContrastViolations(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withRules(['color-contrast'])
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()
  const summary = violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? v.help}`),
  )
  expect(summary, `color-contrast violations: ${label}`).toEqual([])
}

const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/

/** AD-7: collects requests to Google Fonts; call `expectNone()` at the end of a run. */
export function watchFontRequests(page: Page) {
  const hits: string[] = []
  page.on('request', (request) => {
    if (GOOGLE_FONTS.test(request.url())) hits.push(request.url())
  })
  return { expectNone: () => expect(hits, 'requests to Google Fonts').toEqual([]) }
}

/** The computed value of a token on <html>, for comparing themes. */
export const tokenOf = (page: Page, name: string) =>
  page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  )
