#!/usr/bin/env node
// Build-drift gate for the TypeScript source tree.
//
// The shipped JavaScript under lib/ is emitted from src/ and committed, because
// a github: install runs no build step. This gate compiles the sources into an
// ignored scratch directory and compares the emitted file set and bytes with
// lib/. It never writes to lib/ and never runs a Git command.
//
// The scratch directory is the only path this script ever deletes or writes,
// and it is deleted with `rm -r` before the compiler runs. `--out` is therefore
// confined to node_modules/.build-check (or a path below it); every other value
// is rejected with exit code 2 before any deletion and before tsc starts.
//
// Usage:
//   node scripts/check-build-drift.mjs
//   node scripts/check-build-drift.mjs --expected <dir> --out <dir>
//   node scripts/check-build-drift.mjs --tsconfig <file> --out <dir>
//
// A compiler diagnostic or a non-zero compiler exit is a failure: a build gate
// must never compare, or ship, output from a failed compile. The script does not
// pass --noEmitOnError on the command line; it honours the project setting, and
// it refuses to compare whenever tsc reports an error.
//
// Exit codes: 0 = the emitted tree matches the expected tree byte for byte,
// 1 = drift found, 2 = the compiler failed, did not run, emitted nothing, or
// `--out` was unsafe.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const TSCONFIG = path.join(ROOT, 'tsconfig.json')
const DEFAULT_EXPECTED = path.join(ROOT, 'lib')
// The one directory this script may delete and write. Keep the name stable: the
// ignore rules and the safety tests rely on it.
const SAFE_OUT_ROOT = path.join(ROOT, 'node_modules', '.build-check')
const DEFAULT_OUT = SAFE_OUT_ROOT

const USAGE = [
  'Usage: node scripts/check-build-drift.mjs [--expected <dir>] [--out <dir>] [--tsconfig <file>]',
  '',
  '  --expected <dir>  committed build output to compare against (default: lib)',
  '  --out <dir>       scratch build directory; must be node_modules/.build-check',
  '                    or a path strictly below it (default: node_modules/.build-check)',
  '  --tsconfig <file> compiler project to build (default: tsconfig.json)',
  '  --help            print this message',
].join('\n')

/** Parse the optional path arguments. */
function parseArgs(argv) {
  const options = { expected: DEFAULT_EXPECTED, out: DEFAULT_OUT, tsconfig: TSCONFIG, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--expected' || argument === '--out' || argument === '--tsconfig') {
      const value = argv[index + 1]
      if (typeof value !== 'string' || value === '') {
        throw new Error(`missing value for ${argument}`)
      }
      options[argument.slice(2)] = path.resolve(ROOT, value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return options
}

/** True when `child` equals `parent` or sits below it, compared by path segment. */
function isInsideOrEqual(child, parent) {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Real path of the deepest existing ancestor of an absolute path, or null. */
function deepestExistingRealpath(target) {
  let current = target
  for (;;) {
    try {
      return { existing: current, real: realpathSync(current) }
    } catch (error) {
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

/**
 * Why an `--out` value is unsafe, or null when it is safe.
 *
 * The script deletes `--out` with `rm -r` before the compiler runs, so the path
 * must be lexically inside the scratch root, the scratch root and its parent
 * must not resolve outside the repository through a symlink, and the deepest
 * existing ancestor of the target must not escape the scratch root through a
 * symlink either. String prefixes alone are not enough.
 */
function unsafeOutReason(outPath) {
  if (!isInsideOrEqual(outPath, SAFE_OUT_ROOT)) {
    return `${outPath} is outside the scratch root ${SAFE_OUT_ROOT}`
  }
  const realRoot = realpathSync(ROOT)
  const nodeModules = path.join(ROOT, 'node_modules')
  let realNodeModules
  try {
    realNodeModules = realpathSync(nodeModules)
  } catch (error) {
    return `${nodeModules} cannot be resolved (${error.message})`
  }
  if (!isInsideOrEqual(realNodeModules, realRoot)) {
    return `${nodeModules} resolves outside the repository root (${realNodeModules})`
  }
  let realScratch = null
  try {
    realScratch = realpathSync(SAFE_OUT_ROOT)
  } catch (error) {
    realScratch = null
  }
  if (realScratch !== null) {
    if (!isInsideOrEqual(realScratch, realRoot)) {
      return `${SAFE_OUT_ROOT} resolves outside the repository root (${realScratch})`
    }
    if (!isInsideOrEqual(realScratch, realNodeModules)) {
      return `${SAFE_OUT_ROOT} resolves outside node_modules (${realScratch})`
    }
  }
  const deepest = deepestExistingRealpath(outPath)
  if (deepest === null) {
    return `${outPath} has no resolvable existing ancestor`
  }
  const boundary = realScratch ?? realNodeModules
  if (!isInsideOrEqual(deepest.real, boundary)) {
    return `${outPath} escapes the scratch root through ${deepest.existing} (resolves to ${deepest.real})`
  }
  return null
}

/** List regular files below a directory as sorted POSIX relative paths. */
async function walk(directory) {
  const found = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      for (const nested of await walk(full)) found.push(path.posix.join(entry.name, nested))
    } else if (entry.isFile()) {
      found.push(entry.name)
    }
  }
  return found.sort()
}

/** Hex sha256 of one buffer. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** First differing line number of two text buffers, or 0 when undecidable. */
function firstDifferingLine(expected, actual) {
  const expectedText = expected.toString('utf8')
  const actualText = actual.toString('utf8')
  if (expectedText.includes('\uFFFD') || actualText.includes('\uFFFD')) return 0
  const expectedLines = expectedText.split('\n')
  const actualLines = actualText.split('\n')
  const shared = Math.min(expectedLines.length, actualLines.length)
  for (let index = 0; index < shared; index += 1) {
    if (expectedLines[index] !== actualLines[index]) return index + 1
  }
  return shared + 1
}

/** Print one drift section. */
function printSection(title, entries) {
  if (entries.length === 0) return
  console.log(`${title} (${entries.length}):`)
  for (const entry of entries) console.log(`  ${entry}`)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`build drift check: ${error.message}`)
    console.error(USAGE)
    return 2
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  // Reject an unsafe scratch directory before any deletion and before tsc runs.
  const unsafeReason = unsafeOutReason(options.out)
  if (unsafeReason !== null) {
    console.error(`build drift check: refusing unsafe --out: ${unsafeReason}`)
    console.error(`build drift check: destructive output is confined to ${SAFE_OUT_ROOT}`)
    return 2
  }

  if (!existsSync(options.tsconfig)) {
    console.error(`build drift check: tsconfig not found at ${options.tsconfig}`)
    return 2
  }
  if (!existsSync(TSC)) {
    console.error(`build drift check: TypeScript compiler not found at ${TSC}`)
    return 2
  }
  if (!existsSync(options.expected)) {
    console.error(`build drift check: expected tree not found at ${options.expected}`)
    return 2
  }

  // A stale scratch tree from an interrupted run must never influence the diff.
  await rm(options.out, { recursive: true, force: true })

  const build = spawnSync(
    process.execPath,
    [TSC, '-p', options.tsconfig, '--outDir', options.out, '--pretty', 'false'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  if (build.error) {
    console.error(`build drift check: could not start the compiler: ${build.error.message}`)
    return 2
  }
  const compilerOutput = `${build.stdout ?? ''}${build.stderr ?? ''}`
  const diagnostics = (compilerOutput.match(/error TS\d+/g) ?? []).length
  if (build.status !== 0 || diagnostics > 0) {
    console.error(
      `build drift check: the compiler failed (exit ${build.status ?? 'null'}, ${diagnostics} diagnostic(s)); ` +
        'a failed or diagnostic-bearing build must never be compared or shipped',
    )
    if (compilerOutput.trim() !== '') console.error(compilerOutput.trim())
    return 2
  }
  console.log(`build drift check: tsc exit 0, ${diagnostics} diagnostic(s)`)

  if (!existsSync(options.out)) {
    console.error(`build drift check: the compiler emitted nothing into ${options.out}`)
    if (compilerOutput.trim() !== '') console.error(compilerOutput.trim())
    return 2
  }

  const expectedFiles = await walk(options.expected)
  const emittedFiles = await walk(options.out)
  const expectedSet = new Set(expectedFiles)
  const emittedSet = new Set(emittedFiles)

  const missing = expectedFiles.filter((file) => !emittedSet.has(file))
  const extra = emittedFiles.filter((file) => !expectedSet.has(file))
  const changed = []

  for (const file of expectedFiles) {
    if (!emittedSet.has(file)) continue
    const expectedBuffer = await readFile(path.join(options.expected, file))
    const emittedBuffer = await readFile(path.join(options.out, file))
    if (expectedBuffer.equals(emittedBuffer)) continue
    const line = firstDifferingLine(expectedBuffer, emittedBuffer)
    changed.push(
      [
        `  ${file}`,
        `    expected ${expectedBuffer.length} B sha256=${sha256(expectedBuffer).slice(0, 16)}`,
        `    emitted  ${emittedBuffer.length} B sha256=${sha256(emittedBuffer).slice(0, 16)}`,
        line === 0 ? '    first difference: binary content' : `    first difference: line ${line}`,
      ].join('\n'),
    )
  }

  if (missing.length === 0 && extra.length === 0 && changed.length === 0) {
    console.log(
      `build drift check passed: ${expectedFiles.length} file(s) in ${options.expected} match the fresh build byte for byte`,
    )
    await rm(options.out, { recursive: true, force: true })
    return 0
  }

  // Keep the scratch tree on drift so the log names a directory a human can inspect.
  console.log('build drift check FAILED: the committed output is not the current build')
  printSection('missing from the fresh build', missing)
  printSection('present only in the fresh build', extra)
  printSection('different bytes', changed)
  console.log(`fresh build kept for inspection at ${options.out}`)
  return 1
}

process.exitCode = await main()
