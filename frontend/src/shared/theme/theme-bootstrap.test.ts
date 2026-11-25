import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_CHOICES, THEME_KEY } from './theme-store'

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')
const match = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/.exec(html)
const attrs = match?.[1] ?? ''
const code = match?.[2] ?? ''

function run() {
  new Function(code)()
}
const attr = () => document.documentElement.getAttribute('data-theme')

describe('index.html theme bootstrap', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is a classic synchronous inline script in <head> before any module', () => {
    expect(match).not.toBeNull()
    expect(attrs).not.toMatch(/\b(type|defer|async|src)\b/)
    expect(html.indexOf(code)).toBeLessThan(html.indexOf('type="module"'))
    expect(html.indexOf('<script')).toBeLessThan(html.indexOf('</head>'))
  })

  it('uses the key and values of the store', () => {
    expect(code).toContain(`'${THEME_KEY}'`)
    for (const v of THEME_CHOICES.filter((c) => c !== 'system')) expect(code).toContain(`'${v}'`)
    expect(code).not.toContain("'system'")
  })

  it.each(['light', 'dark'])('applies a stored %s', (value) => {
    localStorage.setItem(THEME_KEY, value)
    run()
    expect(attr()).toBe(value)
  })

  it.each([['system'], ['garbage'], [null]])('leaves System for %s', (value) => {
    if (value !== null) localStorage.setItem(THEME_KEY, value)
    run()
    expect(attr()).toBeNull()
  })

  it('does not throw when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(run).not.toThrow()
    expect(attr()).toBeNull()
  })
})
