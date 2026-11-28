// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// 14yq6g333cc (FIELD-1 timed out under load): every user.type keystroke is a full keydown/input/keyup chain
// plus a React render, so a test that types whole words spends most of its 5 s budget on keystrokes nobody
// asserts. Under a loaded machine that budget ran out. Text that is only data goes in with fill() (one paste);
// user.type stays for short input and for special keys such as {Enter}.
const eslint = new ESLint()

async function ruleIds(code: string, filePath = 'src/features/x/X.test.tsx') {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId)
}

describe('typing budget in component tests (14yq6g333cc)', () => {
  it('rejects user.type of a long plain string', async () => {
    expect(await ruleIds("await user.type(input, 'Customer tier')\n")).toContain(
      'no-restricted-syntax',
    )
  })

  it('rejects a long template literal with no special keys', async () => {
    expect(await ruleIds('await user.type(input, `Customer tier`)\n')).toContain(
      'no-restricted-syntax',
    )
  })

  it('accepts short input, special keys and fill()', async () => {
    expect(await ruleIds("await user.type(input, 'ACME')\n")).not.toContain('no-restricted-syntax')
    expect(await ruleIds("await user.type(input, 'Brand new name{Enter}')\n")).not.toContain(
      'no-restricted-syntax',
    )
    expect(await ruleIds("await fill(user, input, 'Customer tier')\n")).not.toContain(
      'no-restricted-syntax',
    )
  })

  it('does not apply outside test files', async () => {
    expect(
      await ruleIds(
        "export const t = (u: any, i: any) => u.type(i, 'Customer tier')\n",
        'src/test/x.ts',
      ),
    ).not.toContain('no-restricted-syntax')
  })
})
