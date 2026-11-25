// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blend, parseHex, ratio, type Rgb } from './contrast'

// vitest does not return the text of a ?raw css import, so the stylesheets are read from disk.
const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const bridgeCss = readFileSync(new URL('./legacy-bridge.css', import.meta.url), 'utf8')

const MIN = 4.5 // 3:1 would be allowed for text of 24px and larger; the test is stricter and uses 4.5 everywhere.

type Tokens = Record<string, string>

function declarations(block: string): Tokens {
  const out: Tokens = {}
  for (const m of block.matchAll(/--tf-([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

function blockAfter(css: string, head: string): string {
  const start = css.indexOf(head)
  if (start < 0) throw new Error(`block not found: ${head}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

const light = declarations(blockAfter(tokensCss, ":root,\n[data-theme='light']"))
const aurora = declarations(blockAfter(tokensCss, "[data-theme='dark'] {"))
const system = declarations(
  blockAfter(tokensCss, '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme])'),
)
const themes: Record<string, Tokens> = { Light: light, Aurora: aurora }

const TEXT = [
  'fg',
  'muted',
  'faint',
  'accent',
  'danger',
  'status-todo',
  'status-progress',
  'status-review',
  'status-done',
  'priority-urgent',
  'priority-high',
  'priority-normal',
  'priority-low',
]
const GROUNDS = [
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'panel',
  'accent-soft',
  'danger-soft',
  'warn-soft',
  'ok-soft',
  'blue-soft',
]

/** The opaque colours a ground token can end up on: itself blended over `bg` and over `surface`. */
function groundColours(t: Tokens, name: string): Rgb[] {
  const bg = parseHex(t.bg).rgb
  const surface = parseHex(t.surface).rgb
  if (name === 'bg') return [bg]
  if (name === 'surface') return [surface]
  if (name === 'panel') return [blend(t.panel, bg)]
  return [blend(t[name], surface), blend(t[name], bg)]
}

function worst(t: Tokens, text: string, ground: string): number {
  const results: number[] = []
  for (const g of groundColours(t, ground)) {
    results.push(ratio(blend(t[text], g), g))
  }
  return Math.min(...results)
}

describe('contrast helper', () => {
  it('computes WCAG ratios and blends translucent colours', () => {
    expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1)
    expect(ratio([119, 119, 119], [255, 255, 255])).toBeLessThan(MIN)
    expect(blend('#00000080', [255, 255, 255])[0]).toBeCloseTo(127, 0)
  })
})

describe('token contrast (AD-9)', () => {
  for (const [theme, t] of Object.entries(themes)) {
    it(`${theme}: every text token on every ground is at least ${MIN}:1`, () => {
      const failures: string[] = []
      for (const text of TEXT) {
        for (const ground of GROUNDS) {
          const r = worst(t, text, ground)
          if (r < MIN) failures.push(`${text} on ${ground}: ${r.toFixed(2)}`)
        }
      }
      expect(failures).toEqual([])
    })

    it(`${theme}: filled pairs are at least ${MIN}:1`, () => {
      const pairs: [string, string, string][] = [
        ['accent-fg', 'accent', 'accent-fg on accent'],
        ['primary-fg', 'primary-from', 'primary-fg on primary-from'],
        ['primary-fg', 'primary-to', 'primary-fg on primary-to'],
        ['danger-fg', 'danger', 'danger-fg on danger'],
      ]
      for (const [fg, bg, label] of pairs) {
        const ground = parseHex(t[bg]).rgb
        expect(ratio(blend(t[fg], ground), ground), label).toBeGreaterThanOrEqual(MIN)
      }
    })
  }

  it('System-dark declares exactly the Aurora properties and values', () => {
    expect(Object.keys(aurora).length).toBeGreaterThan(30)
    expect(system).toEqual(aurora)
  })

  it('Light and Aurora declare the same token names', () => {
    expect(Object.keys(aurora).sort()).toEqual(Object.keys(light).sort())
  })
})

// ---- the legacy bridge (AD-3) ----

describe('legacy bridge', () => {
  it('has no theme selector and no colour literal', () => {
    const css = bridgeCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/data-theme|prefers-color-scheme/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/)
  })
})

const variableMap = new Map<string, string>() // "slate-500" -> token name
for (const m of bridgeCss.matchAll(/--color-([a-z]+-\d+):\s*var\(--tf-([a-z0-9-]+)\)/g))
  variableMap.set(m[1], m[2])
const textOverride = new Map<string, string>() // "white" -> token name
const bgOverride = new Map<string, string>()
for (const m of bridgeCss.matchAll(
  /\.(text|bg)-([a-z0-9-]+)\s*\{\s*(?:color|background-color):\s*var\(--tf-([a-z0-9-]+)\)/g,
))
  (m[1] === 'text' ? textOverride : bgOverride).set(m[2], m[3])

function resolve(kind: 'text' | 'bg', palette: string): string | undefined {
  return (kind === 'text' ? textOverride : bgOverride).get(palette) ?? variableMap.get(palette)
}

const sources = import.meta.glob('../../features/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const PALETTES =
  'white|black|slate|gray|zinc|neutral|stone|red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lime'
const CLASS = new RegExp(`^((?:[a-z-]+:)*)(text|bg)-((?:${PALETTES})(?:-\\d+)?)(?:/\\d+)?$`)

type Use = { kind: 'text' | 'bg'; variant: string; palette: string }

function classStrings(source: string): string[] {
  return [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3])
}

function usesIn(text: string): Use[] {
  const out: Use[] = []
  for (const word of text.split(/\s+/)) {
    const m = CLASS.exec(word)
    if (m) out.push({ variant: m[1], kind: m[2] as 'text' | 'bg', palette: m[3] })
  }
  return out
}

describe('bridged pairs in feature code', () => {
  const found = new Set<string>() // "file | textClass | groundClass"
  const unmapped = new Set<string>()
  const failures: string[] = []

  for (const [file, source] of Object.entries(sources)) {
    if (/\.test\.tsx$/.test(file)) continue
    for (const str of classStrings(source)) {
      const uses = usesIn(str)
      const texts = uses.filter((u) => u.kind === 'text')
      const grounds = uses.filter((u) => u.kind === 'bg')
      for (const g of grounds)
        if (g.palette !== 'black' && !resolve('bg', g.palette))
          unmapped.add(`${file}: bg-${g.palette}`)
      for (const tx of texts) {
        if (tx.palette === 'black') continue
        const token = resolve('text', tx.palette)
        if (!token) {
          unmapped.add(`${file}: text-${tx.palette}`)
          continue
        }
        const same = grounds.filter((g) => g.variant === tx.variant)
        const picked = same.length > 0 ? same : grounds.filter((g) => g.variant === '')
        const groundTokens =
          picked.length > 0
            ? picked.map((g) => resolve('bg', g.palette)).filter((x): x is string => !!x)
            : ['bg', 'surface']
        for (const gt of groundTokens) {
          const label = `${tx.variant}text-${tx.palette} (${token}) on ${gt}`
          found.add(label)
          for (const [theme, t] of Object.entries(themes)) {
            const r = worst(t, token, gt)
            if (r < MIN) failures.push(`${file}: ${label} in ${theme}: ${r.toFixed(2)}`)
          }
        }
      }
    }
  }

  it('finds the pairs feature code uses', () => {
    expect(found.size).toBeGreaterThan(20)
  })

  it('maps every palette class feature code uses', () => {
    expect([...unmapped]).toEqual([])
  })

  it(`meets ${MIN}:1 in Light and Aurora`, () => {
    expect([...new Set(failures)]).toEqual([])
  })
})
