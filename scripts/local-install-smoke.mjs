#!/usr/bin/env node
// Local install smoke for the committed-build distribution.
//
// The shipped JavaScript under lib/ is emitted from src/ and committed, because
// a github: install runs no build step. This script proves that the package a
// GitHub install receives really is that committed build:
//
// * default mode packs the working tree with `npm pack`, installs the tarball
//   into a scratch consumer under node_modules/, and checks the installed
//   artifact: the file list, the absence of build/install hooks, the main and
//   subpath exports, the Config schema, and the browser bundle envelope.
// * spec mode (`node scripts/local-install-smoke.mjs github:<owner>/<repo>#<sha>`)
//   installs that exact spec instead of the tarball and runs the same runtime
//   assertions. Network access is needed only in that mode, or when npm has to
//   resolve the peer dependency while installing the tarball.
//
// Everything the script creates lives under node_modules/ and is removed on
// exit, including the workspace npm cache path it passes to npm. The script
// never writes lib/, package.json, the Git index, or any profile directory.
//
// Usage:
//   node scripts/local-install-smoke.mjs
//   node scripts/local-install-smoke.mjs github:PipaGs/dsh-you-should-know#<sha>
//   node scripts/local-install-smoke.mjs --help

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'dsh-you-should-know'
const SCRATCH = join(ROOT, 'node_modules', '.smoke-local')
const PACK_DIR = join(SCRATCH, 'pack')
const CONSUMER = join(SCRATCH, 'consumer')
const NPM_CACHE = join(ROOT, 'node_modules', '.npm-cache')
const WORKSPACE_PEER = join(ROOT, 'node_modules', '@deepseek-ai')
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const USAGE = [
  'Usage: node scripts/local-install-smoke.mjs [<install-spec>]',
  '',
  '  <install-spec>  install this spec instead of the packed working tree,',
  '                  for example github:PipaGs/dsh-you-should-know#<sha>',
  '  --help          print this message',
].join('\n')

// npm flags shared by every call: workspace cache, no notifier, no audit, no
// funding message, and no log files outside the workspace.
const NPM_BASE_ARGS = [
  '--cache',
  NPM_CACHE,
  '--logs-max=0',
  '--no-update-notifier',
  '--no-audit',
  '--no-fund',
]

/** Parse the one optional install spec. */
function parseArgs(argv) {
  const options = { spec: null, help: false }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown argument: ${argument}`)
    } else if (options.spec === null) {
      options.spec = argument
    } else {
      throw new Error(`unexpected extra argument: ${argument}`)
    }
  }
  return options
}

/** Find npm without assuming it is on this Node's own command path. */
function npmInvocation() {
  const execPath = process.env.npm_execpath
  if (typeof execPath === 'string' && execPath.endsWith('npm-cli.js')) {
    return { command: process.execPath, args: [execPath] }
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] }
}

/** Run one npm command in a directory and capture both streams. */
function runNpm(args, cwd) {
  const npm = npmInvocation()
  return spawnSync(npm.command, [...npm.args, ...args, ...NPM_BASE_ARGS], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Print one check line and count a failure. */
function makeChecker() {
  const state = { checks: 0, failures: 0 }
  const check = (label, condition, detail) => {
    state.checks += 1
    if (condition) {
      console.log(`ok   ${label}`)
      return true
    }
    state.failures += 1
    console.log(`FAIL ${label}${detail === undefined ? '' : `: ${detail}`}`)
    return false
  }
  return { state, check }
}

/** The file list `npm pack` produced for the working tree. */
function packWorkingTree(check) {
  rmSync(PACK_DIR, { recursive: true, force: true })
  mkdirSync(PACK_DIR, { recursive: true })
  const result = runNpm(['pack', '--json', '--pack-destination', PACK_DIR], ROOT)
  if (result.status !== 0) {
    console.error(`local install smoke: npm pack failed with exit ${result.status ?? 'null'}`)
    if ((result.stderr ?? '').trim() !== '') console.error(result.stderr.trim())
    return null
  }
  let packed
  try {
    packed = JSON.parse(result.stdout)
  } catch (error) {
    console.error(`local install smoke: could not parse npm pack --json output: ${error.message}`)
    return null
  }
  const tarball = Array.isArray(packed) ? packed[0] : null
  if (tarball === undefined || tarball === null || !Array.isArray(tarball.files)) {
    console.error('local install smoke: npm pack returned no tarball record')
    return null
  }
  check(
    `npm pack names ${NAME}@${MANIFEST.version} and reports every packed file`,
    tarball.name === NAME && tarball.version === MANIFEST.version && tarball.files.length > 0,
    `${tarball.name}@${tarball.version} with ${tarball.files.length} entries`,
  )
  return { tarball, path: join(PACK_DIR, tarball.filename) }
}

/** Assert the tarball carries the committed build and no source or dev files. */
function checkTarballContents(check, packed) {
  console.log(`tarball: ${packed.tarball.filename} (${packed.tarball.files.length} entries)`)
  const paths = packed.tarball.files.map((file) => file.path)
  const present = new Set(paths)

  const emitted = readdirSync(join(ROOT, 'lib')).filter((file) => file.endsWith('.js')).sort()
  const missingLib = emitted.filter((file) => !present.has(`lib/${file}`))
  check(
    `the tarball contains all ${emitted.length} emitted lib/*.js files`,
    emitted.length > 0 && missingLib.length === 0,
    `missing: ${missingLib.join(', ')}`,
  )

  for (const required of ['package.json', 'README.md', 'docs/reference.md', 'cordis.patch.yml', 'LICENSE']) {
    check(`the tarball contains ${required}`, present.has(required), `present: ${paths.join(', ')}`)
  }

  const forbidden = paths.filter(
    (file) =>
      file === 'src' ||
      file.startsWith('src/') ||
      file.startsWith('test/') ||
      file.startsWith('scripts/') ||
      file.endsWith('.ts') ||
      file.endsWith('.d.ts') ||
      file.endsWith('.map'),
  )
  check(
    'the tarball contains no source, declaration, map, test, or dev-script entries',
    forbidden.length === 0,
    `offenders: ${forbidden.join(', ')}`,
  )
}

/** Skip the peer resolution or link the installed workspace copy into the consumer. */
function ensurePeerDependency(check) {
  const consumerRequire = createRequire(join(CONSUMER, 'package.json'))
  const resolves = () => {
    try {
      consumerRequire.resolve('@deepseek-ai/schemastery/package.json')
      return true
    } catch {
      return false
    }
  }
  if (resolves()) {
    console.log('peer: @deepseek-ai/schemastery resolved by npm')
    return
  }
  const target = join(CONSUMER, 'node_modules', '@deepseek-ai')
  if (!existsSync(WORKSPACE_PEER)) {
    check('the peer @deepseek-ai/schemastery resolves from the consumer', false, 'workspace copy is absent')
    return
  }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(WORKSPACE_PEER, target, 'dir')
  console.log('peer: symlinked the installed workspace @deepseek-ai copy into the consumer')
  check('the peer @deepseek-ai/schemastery resolves from the consumer after the link', resolves(), target)
}

/** Create the throwaway consumer and install the tarball or the caller spec. */
function installIntoConsumer(check, target, label) {
  rmSync(CONSUMER, { recursive: true, force: true })
  mkdirSync(CONSUMER, { recursive: true })
  writeFileSync(
    join(CONSUMER, 'package.json'),
    `${JSON.stringify({ name: 'dsh-you-should-know-local-smoke', private: true, version: '0.0.0' }, null, 2)}\n`,
  )
  let result = runNpm(['install', target, '--ignore-scripts', '--no-save'], CONSUMER)
  if (result.status !== 0) {
    // A peer dependency that npm cannot resolve must not hide the artifact
    // checks; retry without peer auto-install and link the workspace copy.
    console.log(`install: ${label} failed with npm exit ${result.status ?? 'null'}; retrying without peer auto-install`)
    result = runNpm(['install', target, '--ignore-scripts', '--no-save', '--legacy-peer-deps'], CONSUMER)
  }
  const installed = result.status === 0 && existsSync(join(CONSUMER, 'node_modules', NAME, 'package.json'))
  check(`npm installs ${label} into a scratch consumer with --ignore-scripts`, installed, (result.stderr ?? '').trim().slice(-2000))
  if (!installed) return false
  ensurePeerDependency(check)
  return true
}

/** Read the installed package.json and assert there is no install hook. */
function checkInstalledManifest(check) {
  const consumerRequire = createRequire(join(CONSUMER, 'package.json'))
  const manifestPath = consumerRequire.resolve(`${NAME}/package.json`)
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const scripts = installed.scripts ?? {}
  const hooks = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack'].filter(
    (name) => scripts[name] !== undefined,
  )
  check('the installed package.json declares no install, prepare, or pack script', hooks.length === 0, hooks.join(', '))
  check(
    'the installed package keeps the committed lib output as its entry points',
    installed.main === './lib/index.js' && installed.exports?.['.'] === './lib/index.js',
    `${installed.main} / ${installed.exports?.['.']}`,
  )
  return { manifestPath, installed }
}

/** The probe runs real bare-specifier ESM imports from the consumer location. */
function runConsumerProbe(check) {
  const probe = [
    `import * as pkg from '${NAME}'`,
    'const out = { keys: Object.keys(pkg).sort() }',
    'out.name = pkg.name',
    'out.version = pkg.PLUGIN_VERSION',
    'out.applyType = typeof pkg.apply',
    'const Config = pkg.Config',
    'out.config = {',
    "  type: typeof Config,",
    '  hasDict: Boolean(Config && Config.dict),',
    '  volatileCount: Config && Config.dict',
    '    ? Object.values(Config.dict).filter((field) => field && field.meta && field.meta.volatile === true).length',
    '    : 0,',
    '}',
    `out.clientUrl = import.meta.resolve('${NAME}/client')`,
    `out.coreUrl = import.meta.resolve('${NAME}/core')`,
    'globalThis.window = { __ModuleLoader__: { load(entry) { globalThis.__entry = entry } } }',
    `await import('${NAME}/client')`,
    'out.clientEntry = { id: globalThis.__entry && globalThis.__entry.id, factory: typeof (globalThis.__entry && globalThis.__entry.factory) }',
    'console.log(JSON.stringify(out))',
    '',
  ].join('\n')
  writeFileSync(join(CONSUMER, 'probe.mjs'), probe)
  const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: CONSUMER, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    check('the consumer probe imports the installed package', false, (result.stderr ?? '').trim().slice(-2000))
    return null
  }
  check('the consumer probe imports the installed package', true)
  try {
    return JSON.parse(result.stdout.trim().split('\n').pop())
  } catch (error) {
    check('the consumer probe prints one JSON result', false, error.message)
    return null
  }
}

/** Assert the exported surface and both subpath exports. */
function checkExports(check, probe, installedVersion) {
  check(`import('${NAME}') exposes name`, probe.name === NAME, String(probe.name))
  check(
    `import('${NAME}') exposes PLUGIN_VERSION matching the installed package`,
    probe.version === installedVersion,
    `${probe.version} != ${installedVersion}`,
  )
  check(`import('${NAME}') exposes apply`, probe.applyType === 'function', String(probe.applyType))
  check(
    `import('${NAME}') exposes Config as a schemastery schema with volatile fields`,
    probe.config.type === 'function' && probe.config.hasDict === true && probe.config.volatileCount > 0,
    JSON.stringify(probe.config),
  )

  const clientUrl = probe.clientUrl.startsWith('file:') ? fileURLToPath(probe.clientUrl) : ''
  const coreUrl = probe.coreUrl.startsWith('file:') ? fileURLToPath(probe.coreUrl) : ''
  check(`import('${NAME}/client') resolves to the installed browser half`, clientUrl.endsWith('/lib/client.js') && existsSync(clientUrl), String(probe.clientUrl))
  check(`import('${NAME}/core') resolves to the installed core module`, coreUrl.endsWith('/lib/core.js') && existsSync(coreUrl), String(probe.coreUrl))
  check('the installed browser half registers the host module-table envelope', probe.clientEntry.id === NAME && probe.clientEntry.factory === 'function', JSON.stringify(probe.clientEntry))
  return { clientUrl, coreUrl }
}

/** Assert the installed client file is a classic browser script. */
function checkClientBundleText(check, clientPath) {
  const text = readFileSync(clientPath, 'utf8')
  const topLevelModuleSyntax = text
    .split('\n')
    .filter((line) => /^(?:import|export)\b/.test(line))
  check('the installed lib/client.js has no top-level import or export', topLevelModuleSyntax.length === 0, topLevelModuleSyntax.join(' | '))
  const envelope =
    text.includes('window.__ModuleLoader__.load({') &&
    /\bid:\s*'dsh-you-should-know'/.test(text) &&
    /factory\(require\)\s*\{/.test(text)
  check('the installed lib/client.js is a window.__ModuleLoader__.load({ id, factory(require) }) script', envelope)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`local install smoke: ${error.message}`)
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const { state, check } = makeChecker()
  console.log(`workspace: ${ROOT}`)
  try {
    mkdirSync(SCRATCH, { recursive: true })

    let target
    let label
    if (options.spec === null) {
      const packed = packWorkingTree(check)
      if (packed === null) return 1
      checkTarballContents(check, packed)
      target = packed.path
      label = `the packed working tree (${packed.tarball.filename})`
    } else {
      target = options.spec
      label = `the caller spec ${options.spec}`
    }

    if (!installIntoConsumer(check, target, label)) {
      console.log(`result: ${state.checks} checks, ${state.failures} failed`)
      return 1
    }
    const installed = checkInstalledManifest(check)
    const probe = runConsumerProbe(check)
    if (probe !== null) {
      const resolved = checkExports(check, probe, installed.installed.version)
      if (resolved.clientUrl !== '') checkClientBundleText(check, resolved.clientUrl)
    }
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true })
  }

  console.log(`result: ${state.checks} checks, ${state.failures} failed`)
  if (state.failures > 0) {
    console.error(`local install smoke failed: ${state.failures} check(s)`)
    return 1
  }
  console.log('local install smoke passed')
  return 0
}

process.exitCode = await main()
