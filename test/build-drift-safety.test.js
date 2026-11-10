import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The drift gate deletes its `--out` directory with `rm -r` before compiling.
// These checks prove that an unsafe `--out` is rejected before that deletion and
// that a disposable sentinel outside the scratch root survives every attempt.

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCRIPT = path.join(ROOT, 'scripts', 'check-build-drift.mjs')
const SCRATCH_ROOT = path.join(ROOT, 'node_modules', '.build-check')
const OUTSIDE = path.join(ROOT, 'node_modules', `.build-drift-outside-${process.pid}`)
const LOOKALIKE = path.join(ROOT, 'node_modules', `.build-check-evil-${process.pid}`)
const ESCAPE_LINK = path.join(SCRATCH_ROOT, `escape-link-${process.pid}`)
const CUSTOM_OUT = path.join(SCRATCH_ROOT, `custom-${process.pid}`)
const SENTINEL = 'sentinel: this file must survive an unsafe --out rejection byte for byte\n'
const TIMEOUT_MS = 60_000

/** Run the real gate with the given arguments from the repository root. */
function runDrift(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Remove a disposable fixture tree, ignoring an already-absent path. */
function removeFixture(target) {
  rmSync(target, { recursive: true, force: true })
}

/** Remove a fixture symlink without following it. */
function removeLink(target) {
  try {
    lstatSync(target)
    unlinkSync(target)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/** Assert a rejection: exit 2, unsafe-out message, byte-identical sentinel. */
function assertRejected(result, label, sentinelPath) {
  const details = `stdout=${JSON.stringify(result.stdout ?? '')} stderr=${JSON.stringify(result.stderr ?? '')}`
  assert.equal(result.status, 2, `${label}: expected exit code 2 (${details})`)
  assert.match(result.stderr ?? '', /refusing unsafe --out/, `${label}: expected the unsafe --out message (${details})`)
  const after = readFileSync(sentinelPath)
  assert.ok(after.equals(Buffer.from(SENTINEL)), `${label}: the sentinel must stay byte-identical`)
}

function assertPassed(result, label, outputPattern) {
  const details = `stdout=${JSON.stringify(result.stdout ?? '')} stderr=${JSON.stringify(result.stderr ?? '')}`
  assert.equal(result.status, 0, `${label}: expected exit code 0 (${details})`)
  assert.match(result.stdout ?? '', outputPattern, `${label}: expected the drift pass message (${details})`)
}

test('the build drift gate confines destructive output to the scratch root', () => {
  try {
    // A disposable target outside the scratch root, plus a sibling that only
    // looks like the scratch root.
    removeFixture(OUTSIDE)
    removeFixture(LOOKALIKE)
    mkdirSync(OUTSIDE, { recursive: true })
    mkdirSync(LOOKALIKE, { recursive: true })
    writeFileSync(path.join(OUTSIDE, 'sentinel.txt'), SENTINEL)
    writeFileSync(path.join(LOOKALIKE, 'sentinel.txt'), SENTINEL)

    // Arbitrary absolute path outside the scratch root.
    assertRejected(runDrift(['--out', OUTSIDE]), 'absolute outside path', path.join(OUTSIDE, 'sentinel.txt'))

    // Sibling lookalike: a string prefix check would wrongly accept it.
    assertRejected(
      runDrift(['--out', path.relative(ROOT, LOOKALIKE)]),
      'sibling lookalike',
      path.join(LOOKALIKE, 'sentinel.txt'),
    )

    // Lexical traversal that resolves outside the scratch root.
    const traversal = path.posix.join('node_modules', '.build-check', '..', '..', path.relative(ROOT, OUTSIDE))
    assertRejected(runDrift(['--out', traversal]), 'traversal outside the scratch root', path.join(OUTSIDE, 'sentinel.txt'))

    // Symlink escape: the deepest existing ancestor resolves outside the root.
    mkdirSync(SCRATCH_ROOT, { recursive: true })
    removeLink(ESCAPE_LINK)
    symlinkSync(OUTSIDE, ESCAPE_LINK, 'dir')
    const symlinkOut = path.posix.join('node_modules', '.build-check', path.basename(ESCAPE_LINK), 'nested')
    assertRejected(runDrift(['--out', symlinkOut]), 'symlink escape', path.join(OUTSIDE, 'sentinel.txt'))

    // The default invocation still builds, compares, and reports 13 files.
    assertPassed(runDrift([]), 'default drift run', /build drift check passed: 13 file\(s\)/)

    // An explicit directory strictly below the scratch root is allowed.
    assertPassed(
      runDrift(['--out', path.relative(ROOT, CUSTOM_OUT)]),
      'explicit safe subdirectory',
      /build drift check passed: 13 file\(s\)/,
    )
  } finally {
    removeLink(ESCAPE_LINK)
    removeFixture(CUSTOM_OUT)
    removeFixture(LOOKALIKE)
    removeFixture(OUTSIDE)
  }
})
