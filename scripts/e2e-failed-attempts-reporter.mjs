#!/usr/bin/env node
// Playwright reporter that writes only the failed attempts of a run (epic 14yq6g334tf, ClickUp 14yq6g333cd).
// Playwright's own JSON reporter kept every result with its output in one string and crashed on a 1080-test
// repeat run ("RangeError: Invalid string length"), so a run where every test passed exited 1. This keeps
// nothing for a passed attempt; the file has the shape scripts/e2e-failures.mjs reads ({ suites: [...] }).
//
// Used by frontend/playwright.config.ts: ['../scripts/e2e-failed-attempts-reporter.mjs', { outputFile }].
// Self-test (run by scripts/e2e-local.sh before every run): node scripts/e2e-failed-attempts-reporter.mjs --self-test
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { failedAttempts } from './e2e-failures.mjs'

const BAD = new Set(['failed', 'timedOut', 'interrupted'])
const KEPT = new Set(['trace', 'screenshot'])

export default class FailedAttemptsReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile
    /** test -> its failed attempts only */
    this.failed = new Map()
  }

  printsToStdio() {
    return false
  }

  onTestEnd(test, result) {
    if (!BAD.has(result.status)) return
    const attempts = this.failed.get(test) ?? []
    attempts.push({
      status: result.status,
      retry: result.retry,
      attachments: (result.attachments ?? [])
        .filter((a) => a.path && KEPT.has(a.name))
        .map((a) => ({ name: a.name, path: a.path })),
    })
    this.failed.set(test, attempts)
  }

  /** The report for the tests that failed or were flaky; a passed test is not in it. */
  report() {
    const specs = []
    for (const [test, results] of this.failed) {
      const status = test.outcome()
      if (status !== 'unexpected' && status !== 'flaky') continue
      // titlePath(): ['', project, file, ...describes, title]
      specs.push({ title: test.titlePath().slice(3).join(' > '), file: test.location?.file, tests: [{ status, results }] })
    }
    return { suites: [{ title: '', specs }] }
  }

  onEnd() {
    if (!this.outputFile) return
    mkdirSync(dirname(this.outputFile), { recursive: true })
    writeFileSync(this.outputFile, JSON.stringify(this.report()))
  }
}

function selfTest() {
  const check = (ok, message) => {
    if (!ok) throw new Error(`e2e-failed-attempts-reporter self-test: ${message}`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'e2e-reporter-'))
  try {
    const out = join(dir, 'results.json')
    const reporter = new FailedAttemptsReporter({ outputFile: out })
    const big = 'x'.repeat(64 * 1024)
    const fakeTest = (title, outcome) => ({
      titlePath: () => ['', 'chromium', 'a.spec.ts', title],
      location: { file: 'a.spec.ts' },
      outcome: () => outcome,
    })
    // A run far bigger than the 1080 tests that crashed the JSON reporter, each attempt with a large output.
    for (let i = 0; i < 20_000; i++) {
      reporter.onTestEnd(fakeTest(`passes ${i}`, 'expected'), {
        status: 'passed',
        retry: 0,
        stdout: [big],
        attachments: [{ name: 'trace', path: '/nowhere' }],
      })
    }
    const hard = fakeTest('fails hard', 'unexpected')
    reporter.onTestEnd(hard, {
      status: 'failed',
      retry: 0,
      stdout: [big],
      attachments: [
        { name: 'trace', path: '/t.zip' },
        { name: 'screenshot', path: '/s.png' },
        { name: 'video', path: '/v.webm' },
      ],
    })
    const flaky = fakeTest('flaky one', 'flaky')
    reporter.onTestEnd(flaky, { status: 'timedOut', retry: 0, attachments: [{ name: 'trace', path: '/f.zip' }] })
    reporter.onTestEnd(flaky, { status: 'passed', retry: 1, attachments: [] })
    reporter.onEnd()

    check(statSync(out).size < 4096, `the report holds only the failed attempts (${statSync(out).size} bytes)`)
    const found = failedAttempts(JSON.parse(readFileSync(out, 'utf8')))
    check(found.length === 2, `expected 2 failed attempts, got ${found.length}`)
    check(found[0].title === 'fails hard' && found[0].final === 'failed' && found[0].files.length === 2, 'hard failure')
    check(found[1].title === 'flaky one' && found[1].final.startsWith('flaky') && found[1].files.length === 1, 'flaky')

    const config = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../frontend/playwright.config.ts'), 'utf8')
    check(!/\[\s*['"]json['"]/.test(config), "playwright.config.ts must not use Playwright's 'json' reporter")
    check(config.includes('e2e-failed-attempts-reporter.mjs'), 'playwright.config.ts uses this reporter')
    console.log('e2e-failed-attempts-reporter self-test: ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') selfTest()
  else {
    console.error('usage: e2e-failed-attempts-reporter.mjs --self-test (as a reporter: see frontend/playwright.config.ts)')
    process.exit(2)
  }
}
