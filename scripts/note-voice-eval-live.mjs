// Manual, opt-in live runner for the note-voice evaluation.
//
// The standalone scripts/note-voice-eval.mjs never opens a provider connection.
// This runner is the trusted host caller it expects: it injects a real DeepSeek
// Messages stream for the configured deepseek-official/deepseek-flash route and
// hands it to the same runEvaluation, which keeps four cases, one attempt per
// case, concurrency 1, bounded deadlines, and no hidden retries.
//
// It is deliberately manual and double-gated:
//   * it only runs with --live, and
//   * only with --confirm-spend after the owner has authorized the spend, and
//   * only when DEEPSEEK_API_KEY is present in the runner environment.
// The key is read from the environment (never from argv), is never logged, and
// is never written to the emitted report.
//
// Run it manually:
//   DEEPSEEK_API_KEY=... node scripts/note-voice-eval-live.mjs --live --confirm-spend
import { runEvaluation } from './note-voice-eval.mjs'
import {
  DEEPSEEK_MESSAGES_URL,
  DEEPSEEK_MODEL,
  DEEPSEEK_PROVIDER,
  createDeepSeekStream,
} from './note-voice-eval-deepseek.mjs'

export const LIVE_RUNNER_VERSION = 'note-voice-live-1'
export const LIVE_TASK_ID = 'ysk-note-voice-live-20261014'
export const LIVE_ROUTE = Object.freeze({ provider: DEEPSEEK_PROVIDER, model: DEEPSEEK_MODEL })

/**
 * Bounded overrides for a real provider round trip. The fixed defaults in
 * note-voice-eval.mjs (20s per call, 90s total) target injected test streams;
 * the live runner keeps the same shape but gives a live endpoint a longer, still
 * bounded deadline so a slow-but-healthy call is not misread as a drop. The
 * call/attempt/case counts stay fixed at 4 x 1.
 */
export const LIVE_LIMITS = Object.freeze({
  callTimeoutMs: 60000,
  closeGraceMs: 2000,
  totalDeadlineMs: 300000,
})

/** Fail-closed gate for the manual runner. */
export function resolveLiveRunGate({ argv = [], env = {} } = {}) {
  const args = Array.isArray(argv) ? argv : []
  const requested = args.includes('--live')
  const confirmed = args.includes('--confirm-spend')
  const key = env !== null && typeof env === 'object' && typeof env.DEEPSEEK_API_KEY === 'string'
    ? env.DEEPSEEK_API_KEY.trim()
    : ''
  if (!requested) {
    return {
      enabled: false,
      exitCode: 0,
      reason: 'live evaluation was not requested; pass --live --confirm-spend only after the owner authorizes the spend',
    }
  }
  if (!confirmed) {
    return {
      enabled: false,
      exitCode: 2,
      reason: 'live evaluation requires the explicit --confirm-spend flag; no call was made',
    }
  }
  if (key === '') {
    return {
      enabled: false,
      exitCode: 2,
      reason: 'DEEPSEEK_API_KEY is not present in the runner environment; no call was made',
    }
  }
  return { enabled: true, exitCode: 0, reason: null }
}

function makeOutPath(argv) {
  const args = Array.isArray(argv) ? argv : []
  const index = args.indexOf('--out')
  if (index === -1) return undefined
  const value = args[index + 1]
  return typeof value === 'string' && value !== '' && value.startsWith('--') === false ? value : undefined
}

/**
 * Run the evaluation through the manual runner.
 *
 * @returns { exitCode, output } where output is the report JSON. exitCode is 0
 *   for a completed run (including FAIL results, which are real observations)
 *   and 2 for a refused live request; the default not-requested path is 0.
 */
export async function runLiveEvaluation({ argv = [], env = {}, fetchImpl = globalThis.fetch, now, outPath, writeFile } = {}) {
  const gate = resolveLiveRunGate({ argv, env })
  const base = {
    runnerVersion: LIVE_RUNNER_VERSION,
    taskId: LIVE_TASK_ID,
    route: gate.enabled ? LIVE_ROUTE : null,
    endpoint: gate.enabled ? DEEPSEEK_MESSAGES_URL : null,
  }
  if (!gate.enabled) {
    const evaluation = await runEvaluation({ gate: { live: false, blocker: gate.reason }, now })
    const output = JSON.stringify({ ...base, syntheticOnly: true, usage: [], rawReplies: [], evaluation }, null, 2)
    return { exitCode: gate.exitCode, output }
  }
  const usage = []
  const rawReplies = []
  const stream = createDeepSeekStream({
    apiKey: env.DEEPSEEK_API_KEY,
    fetchImpl,
    onUsage: (entry) => usage.push(entry),
    onReply: (entry) => rawReplies.push(entry),
  })
  const evaluation = await runEvaluation({
    gate: { live: true },
    stream,
    route: LIVE_ROUTE,
    now,
    limits: LIVE_LIMITS,
  })
  const output = JSON.stringify({ ...base, syntheticOnly: true, usage, rawReplies, evaluation }, null, 2)
  const target = typeof outPath === 'string' && outPath !== '' ? outPath : makeOutPath(argv)
  if (target !== undefined && typeof writeFile === 'function') {
    await writeFile(target, output, 'utf8')
  }
  return { exitCode: 0, output }
}

async function main() {
  const argv = process.argv.slice(2)
  const { writeFile } = await import('node:fs/promises')
  const result = await runLiveEvaluation({
    argv,
    env: process.env,
    outPath: makeOutPath(argv),
    writeFile,
  })
  process.stdout.write(result.output + '\n')
  process.exitCode = result.exitCode
}

function isMainModule() {
  const entry = process.argv[1]
  if (typeof entry !== 'string' || entry === '') return false
  return import.meta.url === new URL('file://' + entry).href
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write('note-voice-eval-live failed: ' + (error && error.message ? error.message : 'unknown error') + '\n')
    process.exitCode = 1
  })
}
