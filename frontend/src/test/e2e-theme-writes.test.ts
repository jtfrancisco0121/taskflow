// @vitest-environment node
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AD-9: since slice 3 the theme store is the one runtime writer of data-theme. A spec that sets the attribute
// itself bypasses the bootstrap and the store (and is overwritten by them), so only design.spec.ts may.
describe('e2e specs never write data-theme', () => {
  const dir = new URL('../../e2e/', import.meta.url)
  const specs = readdirSync(dir).filter((file) => file.endsWith('.ts') && file !== 'design.spec.ts')

  it('scans the specs', () => {
    expect(specs.length).toBeGreaterThan(5)
  })

  it.each(specs)('%s', (file) => {
    const code = readFileSync(new URL(file, dir), 'utf8')
    expect(code).not.toMatch(/(set|remove)Attribute\(\s*['"]data-theme['"]/)
  })
})
