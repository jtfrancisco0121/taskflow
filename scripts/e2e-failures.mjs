#!/usr/bin/env node
// Keeps the evidence of every failed Playwright attempt, even when the test passed on a retry (CAP-15).
// Playwright empties frontend/test-results/ at the start of each run, so a rerun erased the trace of the run
// that failed. This reads the JSON report of the run and copies each failed attempt's trace and screenshot
// to <out>/<test title>-attempt<n>/.
//
// Usage:
//   node scripts/e2e-failures.mjs <results.json> <out dir>   copies and lists the failed attempts
//   node scripts/e2e-failures.mjs --self-test                runs the parser on a fixture (passed, failed, flaky)
// Test of the entry guard (paths with spaces, symlinks): node --test scripts/e2e-failures.test.mjs
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BAD = new Set(['failed', 'timedOut', 'interrupted'])

/** Every test of the report with its final status ("expected", "unexpected", "flaky", "skipped") and attempts. */
export function collectTests(report) {
  const tests = []
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests.push({
          title: [...titles, spec.title].join(' > '),
          file: spec.file,
          status: test.status,
          results: test.results ?? [],
        })
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title && !child.file ? [...titles, child.title] : titles)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return tests
}

/** The failed attempts of the tests that failed or were flaky: { title, final, attempt, files[] }. */
export function failedAttempts(report) {
  const out = []
  for (const test of collectTests(report)) {
    if (test.status !== 'unexpected' && test.status !== 'flaky') continue
    test.results.forEach((result, index) => {
      if (!BAD.has(result.status)) return
      const files = (result.attachments ?? [])
        .filter((a) => a.path && (a.name === 'trace' || a.name === 'screenshot'))
        .map((a) => ({ name: a.name, path: a.path }))
      out.push({
        title: test.title,
        final: test.status === 'flaky' ? 'flaky (passed on retry)' : 'failed',
        attempt: result.retry ?? index,
        files,
      })
    })
  }
  return out
}

const sanitize = (title) => title.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test'

function copyAll(attempts, outDir) {
  for (const attempt of attempts) {
    const dir = join(outDir, `${sanitize(attempt.title)}-attempt${attempt.attempt}`)
    mkdirSync(dir, { recursive: true })
    console.log(`e2e-local: ${attempt.final}: ${attempt.title} (attempt ${attempt.attempt})`)
    for (const file of attempt.files) {
      if (!existsSync(file.path)) {
        console.log(`  ${file.name}: missing at ${file.path}`)
        continue
      }
      const target = join(dir, `${file.name}-${basename(file.path)}`)
      copyFileSync(file.path, target)
      console.log(`  ${file.name}: ${target}`)
    }
    if (attempt.files.length === 0) console.log('  no trace or screenshot was recorded')
  }
}

function main(resultsPath, outDir) {
  if (!existsSync(resultsPath)) {
    console.log('e2e-local: No results file: failed attempts not listed.')
    return
  }
  let report
  try {
    report = JSON.parse(readFileSync(resultsPath, 'utf8'))
  } catch (error) {
    console.log(`e2e-local: The results file is not readable (${error.message}): failed attempts not listed.`)
    return
  }
  const attempts = failedAttempts(report)
  if (attempts.length === 0) {
    console.log('e2e-local: No failed attempts.')
    return
  }
  copyAll(attempts, outDir)
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-failures-'))
  try {
    const trace = join(dir, 'trace.zip')
    const shot = join(dir, 'test-failed-1.png')
    writeFileSync(trace, 'zip')
    writeFileSync(shot, 'png')
    const attempt = (status, retry, attachments = []) => ({ status, retry, attachments })
    const report = {
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          suites: [
            {
              title: 'group',
              specs: [
                { title: 'passes', file: 'a.spec.ts', tests: [{ status: 'expected', results: [attempt('passed', 0)] }] },
                {
                  title: 'fails: hard',
                  file: 'a.spec.ts',
                  tests: [
                    {
                      status: 'unexpected',
                      results: [
                        attempt('failed', 0, [{ name: 'trace', path: trace }, { name: 'screenshot', path: shot }]),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          specs: [
            {
              title: 'flaky one',
              file: 'a.spec.ts',
              tests: [
                {
                  status: 'flaky',
                  results: [attempt('timedOut', 0, [{ name: 'trace', path: trace }]), attempt('passed', 1)],
                },
              ],
            },
          ],
        },
      ],
    }
    const found = failedAttempts(report)
    const check = (ok, message) => {
      if (!ok) throw new Error(`self-test: ${message}`)
    }
    check(found.length === 2, `expected 2 failed attempts, got ${found.length}`)
    check(found[0].title === 'flaky one' && found[0].final.startsWith('flaky') && found[0].files.length === 1, 'flaky attempt')
    check(found[1].title === 'group > fails: hard' && found[1].files.length === 2, 'failed attempt with trace and screenshot')
    check(failedAttempts({ suites: [] }).length === 0, 'an empty report has no failed attempts')
    const out = join(dir, 'out')
    copyAll(found, out)
    check(existsSync(join(out, 'flaky-one-attempt0', 'trace-trace.zip')), 'flaky trace copied')
    check(existsSync(join(out, 'group-fails-hard-attempt0', 'screenshot-test-failed-1.png')), 'screenshot copied')
    console.log('e2e-failures self-test: ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// import.meta.url is percent-encoded and resolved through symlinks, so compare it with the real path as a URL.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv[2] === '--self-test') selfTest()
  else if (process.argv.length >= 4) main(process.argv[2], process.argv[3])
  else {
    console.error('usage: e2e-failures.mjs <results.json> <out dir> | --self-test')
    process.exit(2)
  }
}
