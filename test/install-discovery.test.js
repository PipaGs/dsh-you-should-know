import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const REPO = 'PipaGs/dsh-you-should-know'
const NAME = 'dsh-you-should-know'
const BARE = `github:${REPO}`
const REPO_URL = `https://github.com/${REPO}`

async function read(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

/**
 * The attribution @deepseek-ai/dsh-plugin-manager's installBundle performs after
 * a successful `pnpm add` (installed build, lib/index.js, installBundle):
 *
 *   const installed = Object.keys(after).filter((name) => before[name] !== after[name])
 *   if (installed.length === 0)
 *     installed.push(...Object.keys(after).filter((name) => spec === name || spec.startsWith(`${name}@`)))
 *   const target = installed[0]
 *   if (installed.length !== 1 || target === undefined) throw new ManagementFailure('ambiguous-install')
 *
 * It is reproduced here so a repository change that makes a GitHub install
 * undiscoverable fails this suite instead of failing in Desktop.
 */
function attributeInstall(before, after, spec) {
  const installed = Object.keys(after).filter((name) => before[name] !== after[name])
  if (installed.length === 0) {
    installed.push(...Object.keys(after).filter((name) => spec === name || spec.startsWith(`${name}@`)))
  }
  const target = installed[0]
  if (installed.length !== 1 || target === undefined) return { code: 'ambiguous-install', installed }
  return { name: target, installed }
}

/** The pinned GitHub address the repository documents for one release. */
function pinnedSpec(version) {
  return `github:${REPO}#v${version}`
}

/** Every `dsh plugin ... add <spec>` command inside a shell code block of the README. */
function readmeInstallSpecs(markdown) {
  const specs = []
  for (const block of markdown.matchAll(/```(?:sh|bash|shell)\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) {
      const match = /\bdsh\s+plugin\b[^\n]*?\badd\s+(\S+)/.exec(line)
      if (match) specs.push(match[1])
    }
  }
  return specs
}

test('the package name is the dependency key a GitHub install records', async () => {
  const manifest = JSON.parse(await read('package.json'))
  assert.equal(manifest.name, NAME)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

test('a first GitHub install is discovered from the dependency change', async () => {
  const spec = REPO_URL
  const before = {}
  const after = { [NAME]: BARE }
  assert.deepEqual(attributeInstall(before, after, spec), { name: NAME, installed: [NAME] })
})

test('a bare default-branch spec cannot be re-attributed after the first install', async () => {
  const spec = REPO_URL
  const before = { [NAME]: BARE }
  const after = { [NAME]: BARE }
  assert.deepEqual(attributeInstall(before, after, spec), { code: 'ambiguous-install', installed: [] })
})

test('a tag-pinned spec is discovered over an existing bare install', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const spec = pinnedSpec(manifest.version)
  const before = { [NAME]: BARE }
  const after = { [NAME]: spec }
  assert.deepEqual(attributeInstall(before, after, spec), { name: NAME, installed: [NAME] })
})

test('the README documents only tag-pinned GitHub install addresses', async () => {
  const manifest = JSON.parse(await read('package.json'))
  const specs = readmeInstallSpecs(await read('README.md'))
  assert.ok(specs.length > 0, 'the README must document a dsh plugin add command')
  for (const spec of specs) {
    assert.equal(spec, pinnedSpec(manifest.version), `${spec} is not the pinned address for ${manifest.version}`)
    assert.deepEqual(attributeInstall({ [NAME]: BARE }, { [NAME]: spec }, spec), { name: NAME, installed: [NAME] })
  }
})
