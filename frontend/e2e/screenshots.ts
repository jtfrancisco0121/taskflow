import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

/**
 * Takes a full-page screenshot. It is always attached to the test report; when E2E_SCREENSHOTS_DIR is set
 * (scripts/e2e-local.sh sets it to artifacts/screenshots) it is also written to `<dir>/<name>.png`.
 * It returns the PNG bytes, so a spec can assert two shots differ. Elements marked `data-testid="timestamp"` or `<time>` are masked so a re-run does not churn the files.
 */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<Buffer> {
  const body = await page.screenshot({
    fullPage: true,
    animations: 'disabled',
    mask: [page.locator('time, [data-testid="timestamp"]')],
  })
  await testInfo.attach(name, { body, contentType: 'image/png' })
  const dir = process.env.E2E_SCREENSHOTS_DIR
  if (dir) {
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${name}.png`), body)
  }
  return body
}
