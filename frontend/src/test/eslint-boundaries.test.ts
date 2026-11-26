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
