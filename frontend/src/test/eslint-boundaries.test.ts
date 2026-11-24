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
