// Release consistency gate for a version bump.
//
// A release changes the product version in every mirror that documents the
// running or installable build. This suite pins them together so a future bump
// cannot leave one behind:
//
//   * package.json / package-lock-free manifest version;
//   * PLUGIN_VERSION in the shipped host half;
//   * the README status line and every tag-pinned install address;
//   * the self-check example payload in the README.
//
// It also asserts the version is a plain patch increment over the previous
// release and that no stale previous-version literal is left in a released
// artifact. Historical evaluation records under docs/harness-reports and the
// upstream baseline in docs/upstream legitimately keep older versions and are
// not scanned.
//
// It reads repository files only; it never touches the network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLUGIN_VERSION } from '../lib/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CURRENT = '0.4.6'
const PREVIOUS = '0.4.5'

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8')
}

test('the release version is a patch increment over the previous release', () => {
  const [major, minor, patch] = CURRENT.split('.').map(Number)
  const [pmajor, pminor, ppatch] = PREVIOUS.split('.').map(Number)
  assert.equal(major, pmajor, 'the major version does not change on this release')
  assert.equal(minor, pminor, 'the minor version does not change on this release')
  assert.equal(patch, ppatch + 1, 'the patch version increments by exactly one')
})

test('package.json, PLUGIN_VERSION, and the README install address agree', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.version, CURRENT, 'package.json carries the release version')
  assert.equal(PLUGIN_VERSION, CURRENT, 'the shipped host half carries the release version')

  const readme = read('README.md')
  assert.match(readme, new RegExp('Version \`' + CURRENT + '\`'), 'the README status line names the release')
  const specs = [...readme.matchAll(/^[^\n]*\bdsh\s+plugin\b[^\n]*?\badd\s+(\S+)/gm)].map((m) => m[1])
  assert.ok(specs.length > 0, 'the README documents at least one tag-pinned install address')
  for (const spec of specs) {
    assert.equal(spec, `github:PipaGs/dsh-you-should-know#v${CURRENT}`, spec + ' is the pinned address for ' + CURRENT)
  }
})

test('every README self-check sample version is the released version', () => {
  const readme = read('README.md')
  const sample = readme.slice(readme.indexOf('## Operational verification'))
  for (const field of ['pluginVersion', 'runtimeVersion', 'installedVersion']) {
    assert.match(sample, new RegExp('"' + field + '": "' + CURRENT + '"'), field + ' names the release version')
  }
  assert.match(sample, new RegExp('"currentVersion": "' + CURRENT + '"'), 'the update sample names the release version')
})

test('no released artifact still documents the previous version', () => {
  const stale = new RegExp(PREVIOUS.replace(/\./g, '\\.'))
  for (const path of ['package.json', 'README.md', 'lib/index.js']) {
    assert.equal(stale.test(read(path)), false, path + ' still names ' + PREVIOUS)
  }
})
