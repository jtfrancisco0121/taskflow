// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()

async function ruleIds(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId)
}

describe('feature boundaries (AD-11)', () => {
  it('rejects a deep import into another feature', async () => {
    const ids = await ruleIds(
      "import { X } from '../tasks/internal-file'\nexport const x = X\n",
      'src/features/comments/CommentsTab.tsx',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('rejects a deep feature import from src/app', async () => {
    const ids = await ruleIds(
      "import { X } from '../features/tasks/internal-file'\nexport const x = X\n",
      'src/app/router.tsx',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('rejects src/shared importing src/features', async () => {
    const ids = await ruleIds(
      "import { X } from '../features/tasks'\nexport const x = X\n",
      'src/shared/ui/Thing.tsx',
    )
    expect(ids).toContain('no-restricted-imports')
  })

  it('accepts an import through the feature index', async () => {
    expect(
      await ruleIds(
        "import { X } from '../tasks'\nexport const x = X\n",
        'src/features/comments/CommentsTab.tsx',
      ),
    ).not.toContain('no-restricted-imports')
    expect(
      await ruleIds(
        "import { X } from '../features/tasks/index'\nexport const x = X\n",
        'src/app/router.tsx',
      ),
    ).not.toContain('no-restricted-imports')
  })
})

describe('the component library owns Radix and cmdk (slice 2, AD-4)', () => {
  const radix = "import * as S from '@radix-ui/react-select'\nexport const x = S\n"

  it('rejects a Radix import in a feature', async () => {
    expect(await ruleIds(radix, 'src/features/views/ChipBar.tsx')).toContain(
      'no-restricted-imports',
    )
  })

  it('rejects a cmdk import in src/app and src/design', async () => {
    const cmdk = "import { Command } from 'cmdk'\nexport const x = Command\n"
    expect(await ruleIds(cmdk, 'src/app/router.tsx')).toContain('no-restricted-imports')
    expect(await ruleIds(cmdk, 'src/design/DesignPage.tsx')).toContain('no-restricted-imports')
  })

  it('allows a Radix import in src/shared/ui', async () => {
    expect(await ruleIds(radix, 'src/shared/ui/Select.tsx')).not.toContain('no-restricted-imports')
  })

  it('keeps the feature-boundary patterns next to the Radix ban', async () => {
    const both =
      "import * as S from '@radix-ui/react-select'\nimport { X } from '../tasks/internal-file'\nexport const x = [S, X]\n"
    const [result] = await eslint.lintText(both, { filePath: 'src/features/comments/Tab.tsx' })
    expect(result.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toHaveLength(2)
  })
})

describe('no native <select> in product code (slice 2, AD-5)', () => {
  const code = 'export const A = () => <select aria-label="Pick" />\n'

  it('rejects a native select in a feature file', async () => {
    expect(await ruleIds(code, 'src/features/tasks/TaskFields.tsx')).toContain(
      'no-restricted-syntax',
    )
  })

  it('rejects it in FilterBuilder and FilterInput: the slice-2 exception is gone', async () => {
    for (const file of [
      'src/features/views/FilterBuilder.tsx',
      'src/features/fields/FilterInput.tsx',
    ]) {
      expect(await ruleIds(code, file), file).toContain('no-restricted-syntax')
    }
  })

  it('allows it in test files and test helpers', async () => {
    for (const file of ['src/features/views/Anything.test.tsx', 'src/test/ui.test.tsx']) {
      expect(await ruleIds(code, file), file).not.toContain('no-restricted-syntax')
    }
  })

  it('keeps the test guards on test files', async () => {
    const guarded = "import { x } from 'y'\nx.selectOptions(a, b)\n"
    expect(await ruleIds(guarded, 'src/features/views/Anything.test.tsx')).toContain(
      'no-restricted-syntax',
    )
  })
})

// ClickUp 14yq6g334fe: a failed background refresh flips isError (and drops isSuccess) while the data is still held, so
// a screen that branches on those flags blanks data it has. Product code reads load state through src/api/queryState.ts.
describe('query load state goes through src/api/queryState.ts (14yq6g334fe)', () => {
  const file = 'src/features/tasks/Thing.tsx'
  const restricted = async (code: string, filePath = file) =>
    (await ruleIds(code, filePath)).filter((id) => id === 'no-restricted-syntax')

  it('rejects an early return on query.isError', async () => {
    expect(
      await restricted(
        'export function A(q: any) {\n  if (q.isError) return null\n  return q.data\n}\n',
      ),
    ).toHaveLength(1)
  })

  it('rejects isError in a ternary and isSuccess gating the data', async () => {
    expect(
      await restricted(
        'export const a = (q: any) => (q.isError ? 1 : q.data)\nexport const b = (q: any) => q.isSuccess && q.data\n',
      ),
    ).toHaveLength(2)
  })

  it('rejects a destructured isError or isSuccess, and status compared to "error"', async () => {
    expect(
      await restricted(
        "export function A(q: any) {\n  const { isError, isSuccess } = q\n  return isError || isSuccess || q.status === 'error'\n}\n",
      ),
    ).toHaveLength(3)
  })

  it('rejects a reversed comparison and a destructured status compared to "error"', async () => {
    expect(
      await restricted(
        "export function A(q: any) {\n  const { status } = q\n  return 'error' === q.status || status === 'error' || 'error' !== status\n}\n",
      ),
    ).toHaveLength(3)
  })

  it('rejects them in .ts product code too', async () => {
    expect(
      await restricted('export const a = (q: any) => q.isError', 'src/features/tasks/useThing.ts'),
    ).toHaveLength(1)
  })

  it('accepts the helpers, a mutation error read, and the flags in tests and the helper module', async () => {
    expect(
      await restricted(
        "import { loadFailed, refreshFailed, hasData } from '../../api/queryState'\nexport const a = (q: any, m: any) => [loadFailed(q), refreshFailed(q), hasData(q), m.error]\n",
      ),
    ).toEqual([])
    expect(
      await restricted(
        'export const a = (q: any) => q.isError',
        'src/features/tasks/Thing.test.tsx',
      ),
    ).toEqual([])
    expect(
      await restricted(
        "export const a = (q: any) => q.status === 'error'",
        'src/api/queryState.ts',
      ),
    ).toEqual([])
  })
})
