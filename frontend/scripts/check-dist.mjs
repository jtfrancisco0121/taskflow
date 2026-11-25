// Run after `npm run build` (never inside `npm test`, which runs before it). AD-6: the DEV-only /design page
// must not ship. Fails when dist/ is missing or empty, when a dist file holds the page's marker, and when the
// source no longer holds the marker (so renaming it cannot make the check pass without checking anything).
// `--self-test` builds nothing: it runs the check on a temp dir that holds the marker and expects a failure.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKERS = ['data-tf-design-page', 'DesignPage']
// AD-7: fonts are self-hosted; nothing in the build may point at Google Fonts.
const FORBIDDEN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']
const SOURCE = join(root, 'src/design/DesignPage.tsx')

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}

/** Returns the list of problems; an empty list means the check passes. */
export function check(distDir, sourceFile) {
  const problems = []
  let list = []
  try {
    list = files(distDir)
  } catch {
    problems.push(`${distDir} is missing: run npm run build first`)
  }
  if (problems.length === 0 && list.length === 0) problems.push(`${distDir} is empty`)
  for (const file of list) {
    if (/\.(woff2?|png|ico|svg)$/.test(file)) continue
    const text = readFileSync(file, 'latin1')
    for (const host of FORBIDDEN_HOSTS) {
      if (text.includes(host)) problems.push(`${file} references ${host}: fonts are self-hosted`)
    }
    for (const marker of MARKERS) {
      if (text.includes(marker))
        problems.push(`${file} contains "${marker}": /design must not ship`)
    }
  }
  let source = ''
  try {
    source = readFileSync(sourceFile, 'utf8')
  } catch {
    problems.push(`${sourceFile} is missing: the check would pass without checking anything`)
  }
  if (source && !source.includes(MARKERS[0])) {
    problems.push(`${sourceFile} no longer contains "${MARKERS[0]}": the check would be vacuous`)
  }
  return problems
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'leak.js'), `const x = "${MARKERS[0]}"`)
    const leaked = check(dir, SOURCE)
    if (leaked.length === 0)
      throw new Error('self-test: a dist holding the marker was not rejected')
    const empty = mkdtempSync(join(tmpdir(), 'check-dist-empty-'))
    try {
      if (check(empty, SOURCE).length === 0)
        throw new Error('self-test: an empty dist was not rejected')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
    if (check(join(dir, 'nope'), SOURCE).length === 0)
      throw new Error('self-test: a missing dist was not rejected')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(
    'check-dist self-test: the check fails on a dist with the marker, an empty dist and a missing dist',
  )
}

if (process.argv.includes('--self-test')) {
  selfTest()
} else {
  const problems = check(join(root, 'dist'), SOURCE)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-dist: ${problem}`)
    process.exit(1)
  }
  console.log('check-dist: dist has no /design page code')
}
