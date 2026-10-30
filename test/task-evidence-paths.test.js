// Guard for the task-owned upstream source-policy report and its evidence.
//
// A committed harness report must stay portable: it may describe a failing
// local run, but it must not embed an absolute workstation location. This test
// walks the report directory and flags absolute file URLs and home-directory
// markers. It scans only this task's report directory; the historical capture
// under docs/upstream/evidence is intentionally left untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reportDir = join(repoRoot, 'docs/harness-reports/ysk-upstream-source-policy-20261030')

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

test('task report and evidence contain no absolute workstation paths', () => {
  const files = collectFiles(reportDir)
  assert.ok(files.length > 0, 'the task report directory must contain artifacts')

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
