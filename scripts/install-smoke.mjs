#!/usr/bin/env node
/**
 * Live GitHub install smoke for the attribution @deepseek-ai/dsh-plugin-manager
 * performs after `pnpm add` (installBundle). It runs pnpm in a throwaway
 * directory under the system temp dir, never in a DSH profile, so a run cannot
 * touch ~/.dsh.
 *
 * It proves two things about the address the README documents:
 *   1. a fresh install of the pinned address is attributed to the package name;
 *   2. upgrading an existing bare default-branch install with the pinned address
 *      changes the saved dependency, so it is attributed too.
 * It also records the observed failure: re-adding the bare default-branch
 * address leaves the saved dependency unchanged and is not attributable.
 *
 * The pnpm executable is `DSH_PNPM` (a pnpm JS entry run with this Node) when
 * set, otherwise `pnpm` found on PATH.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const REPO = 'PipaGs/dsh-you-should-know'
const NAME = manifest.name
const BARE = `github:${REPO}`
const BARE_URL = `https://github.com/${REPO}`
const PINNED = process.argv[2] ?? `github:${REPO}#v${manifest.version}`

/** The attribution installBundle performs; returns the discovered name or the refusal code. */
function attributeInstall(before, after, spec) {
  const installed = Object.keys(after).filter((name) => before[name] !== after[name])
  if (installed.length === 0) {
    installed.push(...Object.keys(after).filter((name) => spec === name || spec.startsWith(`${name}@`)))
  }
  const target = installed[0]
  if (installed.length !== 1 || target === undefined) return { code: 'ambiguous-install', installed }
  return { name: target, installed }
}

/** Run pnpm in a directory without inheriting a parent profile's configuration. */
function add(directory, spec) {
  const entry = process.env.DSH_PNPM
  const command = entry ? process.execPath : 'pnpm'
  const args = entry ? [entry, 'add', spec, '--reporter=silent'] : ['add', spec, '--reporter=silent']
  execFileSync(command, args, { cwd: directory, stdio: ['ignore', 'ignore', 'pipe'] })
}

function dependencies(directory) {
  return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).dependencies ?? {}
}

function seed(directory, dependenciesBefore) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name: 'dsh-install-smoke',
    private: true,
    dependencies: dependenciesBefore,
  }, null, 2) + '\n')
}

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  failures += 1
  console.error(`FAIL ${label}: ${detail}`)
}

const fresh = mkdtempSync(join(tmpdir(), 'dsh-install-smoke-fresh-'))
const upgrade = mkdtempSync(join(tmpdir(), 'dsh-install-smoke-upgrade-'))
try {
  seed(fresh, {})
  add(fresh, PINNED)
  const freshAfter = dependencies(fresh)
  check('a fresh pinned install saves the pinned spec', freshAfter[NAME] === PINNED, JSON.stringify(freshAfter))
  check('a fresh pinned install is attributed', JSON.stringify(attributeInstall({}, freshAfter, PINNED)) === JSON.stringify({ name: NAME, installed: [NAME] }), JSON.stringify(attributeInstall({}, freshAfter, PINNED)))

  seed(upgrade, {})
  add(upgrade, BARE_URL)
  const bareAfter = dependencies(upgrade)
  check('a first bare install is attributed', JSON.stringify(attributeInstall({}, bareAfter, BARE_URL)) === JSON.stringify({ name: NAME, installed: [NAME] }), JSON.stringify(bareAfter))
  add(upgrade, BARE_URL)
  const bareAgain = dependencies(upgrade)
  check('re-adding the bare address leaves the dependency unchanged', bareAgain[NAME] === BARE, JSON.stringify(bareAgain))
  check('an unchanged bare re-add is refused as ambiguous', attributeInstall(bareAfter, bareAgain, BARE_URL).code === 'ambiguous-install', JSON.stringify(attributeInstall(bareAfter, bareAgain, BARE_URL)))

  add(upgrade, PINNED)
  const pinnedAfter = dependencies(upgrade)
  check('the pinned address changes an existing bare dependency', pinnedAfter[NAME] === PINNED && bareAgain[NAME] !== pinnedAfter[NAME], JSON.stringify(pinnedAfter))
  check('the pinned upgrade is attributed', JSON.stringify(attributeInstall(bareAgain, pinnedAfter, PINNED)) === JSON.stringify({ name: NAME, installed: [NAME] }), JSON.stringify(attributeInstall(bareAgain, pinnedAfter, PINNED)))
} finally {
  rmSync(fresh, { recursive: true, force: true })
  rmSync(upgrade, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`${failures} install smoke check(s) failed`)
  process.exit(1)
}
console.log('install smoke passed')
