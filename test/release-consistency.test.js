// Release consistency gate for a version bump.
//
// A release changes the product version in every mirror that documents the
// running or installable build. This suite pins them together so a future bump
// cannot leave one behind:
//
//   * package.json / package-lock-free manifest version;
//   * PLUGIN_VERSION in the shipped host half;
//   * the README status line and every tag-pinned install address;
//   * the self-check example payload in the README and in docs/reference.md.
//
// It also asserts the version is exactly one patch step (same minor, patch + 1)
// or exactly one minor step (minor + 1, patch 0) over the previous release. An
// arbitrary jump, a major change, or a step that moves both components fails.
// The increment check parses both sides with the update checker's own stable-tag
// parser, so a version the update route could not read back is rejected here
// too.
//
// It also asserts no stale previous-version literal is left in a released
// artifact. Historical evaluation records under docs/harness-reports and the
// upstream baseline in docs/upstream legitimately keep older versions and are
// not scanned.
//
// It reads repository files only; it never touches the network, and it never
// asserts that the release tag or the GitHub release exists. The version bump is
// committed before publication, and publication is a separate step after it.
//
// PREVIOUS is hand-maintained because the gate must not use the network or read
// tags. A future editor must advance PREVIOUS honestly after each release.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLUGIN_VERSION } from '../lib/index.js'
import { compareVersions, parseStableTag } from '../lib/update.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURRENT = '0.5.2'
const PREVIOUS = '0.5.1'

// A literal dot in a version must not act as a RegExp wildcard.
const CURRENT_PATTERN = CURRENT.replace(/\./g, '\\.')

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8')
}

test('the release version is one patch or one minor step over the previous release', () => {
  const [major, minor, patch] = CURRENT.split('.').map(Number)
  const [pmajor, pminor, ppatch] = PREVIOUS.split('.').map(Number)
  assert.equal(major, pmajor, 'the major version does not change on this release')

  const patchStep = minor === pminor && patch === ppatch + 1
  const minorStep = minor === pminor + 1 && patch === 0
  assert.ok(
    patchStep || minorStep,
    'the release is exactly one step over the previous release: one patch step (' +
      pmajor + '.' + pminor + '.' + (ppatch + 1) + ') or one minor step (' +
      pmajor + '.' + (pminor + 1) + '.0), not ' + CURRENT,
  )

  const currentTag = parseStableTag('v' + CURRENT)
  const previousTag = parseStableTag('v' + PREVIOUS)
  assert.notEqual(currentTag, null, 'v' + CURRENT + ' parses as a stable release tag')
  assert.notEqual(previousTag, null, 'v' + PREVIOUS + ' parses as a stable release tag')
  assert.equal(compareVersions(currentTag, previousTag), 1, 'v' + CURRENT + ' sorts after v' + PREVIOUS)
})

test('package.json, PLUGIN_VERSION, and the README install address agree', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.version, CURRENT, 'package.json carries the release version')
  assert.equal(PLUGIN_VERSION, CURRENT, 'the shipped host half carries the release version')

  const readme = read('README.md')
  assert.match(readme, new RegExp('Version `' + CURRENT_PATTERN + '`'), 'the README status line names the release')
  const specs = [...readme.matchAll(/^[^\n]*\bdsh\s+plugin\b[^\n]*?\badd\s+(\S+)/gm)].map((m) => m[1])
  assert.ok(specs.length > 0, 'the README documents at least one tag-pinned install address')
  for (const spec of specs) {
    assert.equal(spec, `github:PipaGs/dsh-you-should-know#v${CURRENT}`, spec + ' is the pinned address for ' + CURRENT)
  }
})

test('every README and docs/reference self-check sample version is the released version', () => {
  const samples = [
    ['README.md', '## Operational verification'],
    ['docs/reference.md', '## Status and self-check routes'],
  ]
  for (const [path, heading] of samples) {
    const text = read(path)
    const at = text.indexOf(heading)
    assert.notEqual(at, -1, path + ' documents the ' + heading + ' section')
    const sample = text.slice(at)
    for (const field of ['pluginVersion', 'runtimeVersion', 'installedVersion']) {
      assert.match(sample, new RegExp('"' + field + '": "' + CURRENT_PATTERN + '"'), path + ' ' + field + ' names the release version')
    }
    assert.match(sample, new RegExp('"currentVersion": "' + CURRENT_PATTERN + '"'), path + ' update sample names the release version')
  }
})

test('no released artifact still documents the previous version', () => {
  const stale = new RegExp(PREVIOUS.replace(/\./g, '\\.'))
  for (const path of ['package.json', 'README.md', 'docs/reference.md', 'lib/index.js']) {
    assert.equal(stale.test(read(path)), false, path + ' still names ' + PREVIOUS)
  }
})
