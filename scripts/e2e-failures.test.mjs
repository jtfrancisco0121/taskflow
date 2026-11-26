// Test of the entry guard of e2e-failures.mjs: it must run from a path with spaces and through a symlink.
// Run: node --test scripts/e2e-failures.test.mjs
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const source = join(dirname(fileURLToPath(import.meta.url)), 'e2e-failures.mjs')
// Not realpath'd on purpose: on macOS tmpdir() is reached through the /var -> /private/var symlink.
const dir = mkdtempSync(join(tmpdir(), 'e2e failures '))
const copy = join(dir, 'e2e-failures.mjs')
const link = join(dir, 'linked.mjs')
copyFileSync(source, copy)
symlinkSync(copy, link)
after(() => rmSync(dir, { recursive: true, force: true }))

for (const [name, script] of [['a path with spaces', copy], ['a symlink', link]]) {
  test(`--self-test runs from ${name}`, () => {
    const r = spawnSync(process.execPath, [script, '--self-test'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /e2e-failures self-test: ok/)
  })
  test(`no arguments prints the usage from ${name}`, () => {
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /usage: e2e-failures\.mjs/)
  })
}
