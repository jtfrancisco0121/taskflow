// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AD-8: legacy-bridge.css only maps palette classes that some source file still uses; a rebuilt screen
// removes its entries in the same change, so the bridge shrinks towards deletion.
const PALETTES =
  'slate|gray|zinc|neutral|stone|red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lime'

/** Every `palette-shade` a source mentions: any prefixed utility (`divide-`, `placeholder:`, `ring-offset-`, `from-`), opacity suffixes included, and `--color-palette-shade`. */
function usedPaletteKeys(sources: string[]): Set<string> {
  const used = new Set<string>()
  const re = new RegExp(
    `(?:^|[^a-z0-9])(?:--color-|[a-z:-]*-)?(${PALETTES})-(\\d+)(?:/\\d+)?(?![\\w-])`,
    'g',
  )
  for (const source of sources) for (const m of source.matchAll(re)) used.add(`${m[1]}-${m[2]}`)
  return used
}

/** Every `bg-white`-style class a source mentions (white/black have no shade). */
function usedPlainClasses(sources: string[], classes: string[]): Set<string> {
  const used = new Set<string>()
  for (const cls of classes) {
    const re = new RegExp(`(?<![\\w-])${cls.replace(/[-]/g, '\\-')}(?![\\w-])`)
    if (sources.some((source) => re.test(source))) used.add(cls)
  }
  return used
}

describe('usedPaletteKeys', () => {
  it('counts divide-, placeholder:, opacity and --color- forms as used', () => {
    const used = usedPaletteKeys([
      '<div className="divide-slate-200 placeholder:text-slate-400 bg-slate-100/50 ring-offset-blue-300 from-red-50" />',
      'var(--color-green-600)',
    ])
    for (const key of ['slate-200', 'slate-400', 'slate-100', 'blue-300', 'red-50', 'green-600'])
      expect(used.has(key)).toBe(true)
    expect(used.has('amber-100')).toBe(false)
  })
})

describe('legacy-bridge.css has no dead entries', () => {
  const bridge = readFileSync(new URL('./legacy-bridge.css', import.meta.url), 'utf8')
  const code = bridge.replace(/\/\*[\s\S]*?\*\//g, '')
  // the other sources, without the bridge itself and without test files
  const files = Object.entries(
    import.meta.glob(['../../**/*.ts', '../../**/*.tsx', '../../**/*.css'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  )
    .filter(([file]) => !/legacy-bridge\.css$|\.test\.tsx?$/.test(file))
    .map(([, source]) => source)

  it('scans the sources', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('every mapped palette variable is used by a source file', () => {
    const used = usedPaletteKeys(files)
    const dead = [...code.matchAll(/--color-([a-z]+-\d+):/g)]
      .map((m) => m[1])
      .filter((key) => !used.has(key))
    expect(dead).toEqual([])
  })

  it('every class override is used by a source file', () => {
    const classes = [...code.matchAll(/^\s*\.([a-z0-9-]+)\s*\{/gm)].map((m) => m[1])
    const used = usedPlainClasses(files, classes)
    expect(classes.filter((cls) => !used.has(cls))).toEqual([])
  })
})
