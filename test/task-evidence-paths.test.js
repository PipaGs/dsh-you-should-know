// Guard for the task-owned upstream reports and their evidence.
//
// A committed harness report must stay portable: it may describe a failing
// local run, but it must not embed an absolute workstation location. This test
// walks both upstream task report directories and the committed raw upstream
// evidence JSON, and flags absolute file URLs and home-directory markers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_DIRS = [
  join(repoRoot, 'docs/harness-reports/ysk-upstream-source-policy-20261030'),
  join(repoRoot, 'docs/harness-reports/ysk-upstream-behavior-parity-20261030'),
]
const EVIDENCE_DIRS = [join(repoRoot, 'docs/upstream/evidence')]

// Built at runtime so this test file itself carries no literal marker.
const FORBIDDEN_MARKERS = [
  { label: 'absolute file URL', value: 'file' + '://' },
  { label: 'home-directory path', value: '/' + 'Users' + '/' },
  { label: 'home-directory path', value: '/' + 'home' + '/' },
  { label: 'home-directory path', value: 'C:' + '\\' + 'Users' + '\\' },
]

function collectFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

function collectJsonFiles(dir) {
  return collectFiles(dir).filter((file) => file.endsWith('.json'))
}

test('task reports and upstream evidence contain no absolute workstation paths', () => {
  const files = []
  for (const dir of REPORT_DIRS) {
    assert.ok(existsSync(dir), 'the task report directory must exist: ' + relative(repoRoot, dir))
    files.push(...collectFiles(dir))
  }
  for (const dir of EVIDENCE_DIRS) {
    assert.ok(existsSync(dir), 'the upstream evidence directory must exist: ' + relative(repoRoot, dir))
    files.push(...collectJsonFiles(dir))
  }
  assert.ok(files.length > 0, 'the task report directories must contain artifacts')

  const offenders = new Set()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const marker of FORBIDDEN_MARKERS) {
      if (text.includes(marker.value)) {
        offenders.add(`${relative(repoRoot, file)}: ${marker.label}`)
      }
    }
  }

  assert.deepEqual(
    [...offenders],
    [],
    'task artifacts must not contain absolute workstation locations; offenders: ' + [...offenders].join('; '),
  )
})
