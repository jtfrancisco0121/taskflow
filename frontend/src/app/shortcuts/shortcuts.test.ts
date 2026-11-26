// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SHORTCUTS } from '../../shared/shortcuts'

// AD-9: a key handled by the List, the task detail, the palette shortcut or the search box must be in SHORTCUTS.
const sources = import.meta.glob(
  [
    '../../features/views/useListKeys.ts',
    './../palette/useShortcut.ts',
    '../../features/search/SearchBox.tsx',
    '../../features/tasks/TaskPanel.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const handled = new Set(SHORTCUTS.flatMap((s) => s.handles))

/** The `event.key` literals a source compares against (`key === 'j'`, `key !== '/'`, `toLowerCase() !== 'k'`). */
function keysIn(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/(?:key|toLowerCase\(\))\s*[!=]==\s*'([^']+)'/g)) out.add(m[1])
  // the List's editor keys: `{ s: 'status', p: 'priority', ... }`
  const editors = /EDITOR_KEYS[^=]*=\s*\{([^}]*)\}/.exec(source)
  for (const m of (editors?.[1] ?? '').matchAll(/(\w+):/g)) out.add(m[1])
  return [...out]
}

describe('SHORTCUTS lists every handled key', () => {
  it('scans the four handlers', () => {
    expect(Object.keys(sources)).toHaveLength(4)
  })

  for (const [file, source] of Object.entries(sources)) {
    it(`${file.split('/').at(-1)}: every key it handles is listed`, () => {
      const keys = keysIn(source)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.filter((key) => !handled.has(key))).toEqual([])
    })
  }
})
