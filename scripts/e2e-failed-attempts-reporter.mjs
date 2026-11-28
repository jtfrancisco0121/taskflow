#!/usr/bin/env node
// Playwright reporter that writes only the failed attempts of a run (epic 14yq6g334tf, ClickUp 14yq6g333cd).
// Playwright's own JSON reporter kept every result with its output in one string and crashed on a 1080-test
// repeat run ("RangeError: Invalid string length"), so a run where every test passed exited 1. This keeps
// nothing for a passed attempt; the file has the shape scripts/e2e-failures.mjs reads ({ suites: [...] }).
//
// Used by frontend/playwright.config.ts: ['../scripts/e2e-failed-attempts-reporter.mjs', { outputFile }].
// Self-test (run by scripts/e2e-local.sh before every run): node scripts/e2e-failed-attempts-reporter.mjs --self-test
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyAll, failedAttempts, runErrors } from './e2e-failures.mjs'

const BAD = new Set(['failed', 'timedOut', 'interrupted'])
const KEPT = new Set(['trace', 'screenshot'])

export default class FailedAttemptsReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile
    /** test -> its failed attempts only */
    this.failed = new Map()
    /** errors outside any test (global setup, a crashed worker): first line of each */
    this.errors = []
  }

  /** A relative outputFile is relative to the config file's folder, wherever Playwright was started from. */
  onBegin(config) {
    const base = config?.configFile ? dirname(config.configFile) : config?.rootDir
    if (this.outputFile && !isAbsolute(this.outputFile) && base) this.outputFile = resolve(base, this.outputFile)
  }

  onError(error) {
    this.errors.push(String(error?.message ?? error).split('\n')[0])
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
      specs.push({
        title: test.titlePath().slice(3).join(' > '),
        file: test.location?.file,
        repeat: test.repeatEachIndex ?? 0,
        tests: [{ status, results }],
      })
    }
    return { suites: [{ title: '', specs }], errors: this.errors }
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
    const fakeTest = (title, outcome, repeatEachIndex = 0) => ({
      titlePath: () => ['', 'chromium', 'a.spec.ts', title],
      location: { file: 'a.spec.ts' },
      outcome: () => outcome,
      repeatEachIndex,
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
    // --repeat-each: each repeat of a test is its own test case with the same title. Their traces must land in
    // separate folders, or a later repeat overwrites an earlier one's evidence (ClickUp 14yq6g333cd).
    const traces = [0, 1, 2].map((n) => {
      const path = join(dir, `repeat-${n}`, 'trace.zip')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `trace of repeat ${n}`)
      return path
    })
    for (const n of [0, 1, 2]) {
      reporter.onTestEnd(fakeTest('repeated', 'unexpected', n), {
        status: 'failed',
        retry: 0,
        attachments: [{ name: 'trace', path: traces[n] }],
      })
    }
    const flaky = fakeTest('flaky one', 'flaky')
    reporter.onTestEnd(flaky, { status: 'timedOut', retry: 0, attachments: [{ name: 'trace', path: '/f.zip' }] })
    reporter.onTestEnd(flaky, { status: 'passed', retry: 1, attachments: [] })
    reporter.onEnd()

    // A relative outputFile is taken from the config's folder, not the working directory, and an error outside any
    // test (a global setup that threw, a crashed worker) is kept in the report too (review on PR #37).
    const cfgDir = join(dir, 'cfg')
    const relative = new FailedAttemptsReporter({ outputFile: 'nested/results.json' })
    relative.onBegin({ configFile: join(cfgDir, 'playwright.config.ts'), rootDir: join(cfgDir, 'e2e') })
    relative.onError({ message: 'warm-up: the backend did not answer\n    at stack' })
    relative.onEnd()
    const nested = join(cfgDir, 'nested', 'results.json')
    check(existsSync(nested), 'a relative outputFile is resolved against the config folder')
    const errors = JSON.parse(readFileSync(nested, 'utf8')).errors ?? []
    check(errors.length === 1 && errors[0] === 'warm-up: the backend did not answer', `run errors kept (${JSON.stringify(errors)})`)
    check(runErrors({ errors }).length === 1 && runErrors({}).length === 0, 'runErrors reads the kept errors')

    check(statSync(out).size < 4096, `the report holds only the failed attempts (${statSync(out).size} bytes)`)
    const found = failedAttempts(JSON.parse(readFileSync(out, 'utf8')))
    check(found.length === 5, `expected 5 failed attempts, got ${found.length}`)
    check(found[0].title === 'fails hard' && found[0].final === 'failed' && found[0].files.length === 2, 'hard failure')
    check(found[4].title === 'flaky one' && found[4].final.startsWith('flaky') && found[4].files.length === 1, 'flaky')

    const copied = join(dir, 'copied')
    const log = console.log
    console.log = () => {}
    try {
      copyAll(found.filter((a) => a.title === 'repeated'), copied)
    } finally {
      console.log = log
    }
    for (const n of [0, 1, 2]) {
      const folder = join(copied, n === 0 ? 'repeated-attempt0' : `repeated-repeat${n}-attempt0`)
      const kept = existsSync(folder) ? readFileSync(join(folder, 'trace-trace.zip'), 'utf8') : 'missing'
      check(kept === `trace of repeat ${n}`, `repeat ${n} keeps its own trace folder (got ${kept})`)
    }

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
