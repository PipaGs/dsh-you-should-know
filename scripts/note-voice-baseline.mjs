// Offline, per-class baseline scorer for the note voice and finding classes.
//
// The scorer is deliberately offline and deterministic: it reads hand-authored
// fixtures, runs the same parse and admission gates the runtime runs, and
// reports counts per class. It never calls a model, opens a network connection,
// or reads an environment variable.
//
// The observation level is the admitted one. A non-silent reply is parsed and
// grounded exactly as the runtime does, then passed through `admitsVerdict`.
// When that mode gate drops a reply that would otherwise have been speakable,
// the result carries `gated: true` and the silence-side status, so a Paranoid
// suppression stays visible instead of looking like a correct choice to stay
// quiet. That flag is the only source of P3 evidence.
//
// Entailment is an author label on the case, never a derived property. The
// scorer reports the case author's label and, separately, whether the reply's
// quotation literally appears in the case message. A substring match never
// becomes `ENTAIL_OK`.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { groundVerdict, parseVerdict } from '../lib/core.js'
import { admitsVerdict } from '../lib/review-strictness.js'

/** The version of the fixture set and scoring rules. */
export const BASELINE_VERSION = 'note-voice-baseline-1'

/** The authored classes, in report order. `unclassified` stays separate. */
export const BASELINE_CLASSES = Object.freeze([
  'material_defect',
  'requirement_violation',
  'consequence_of_correct_work',
  'hidden_tradeoff',
  'unsupported_success',
  'duplicate_known',
  'legitimate_silence',
  'ambiguous_evidence',
  'model_runtime_error',
  'voice_attribution',
])

/** Per-case statuses. `NOT_RUN` is reserved for a future live runner. */
export const CASE_STATUS = Object.freeze([
  'SPEAK_OK',
  'SPEAK_UNWARRANTED',
  'SILENT_OK',
  'SILENT_MISSED',
  'INVALID',
  'NOT_RUN',
])

/** Entailment labels after the author's lowercase label is normalized. */
export const ENTAIL_VERDICTS = Object.freeze(['ENTAIL_OK', 'ENTAIL_WEAK', 'ENTAIL_UNSUPPORTED'])

const UNCLASSIFIED_CLASS = 'unclassified'
const EXPECTATIONS = Object.freeze(['speak', 'silent'])
const ENTAIL_BY_LABEL = Object.freeze({
  ok: 'ENTAIL_OK',
  weak: 'ENTAIL_WEAK',
  unsupported: 'ENTAIL_UNSUPPORTED',
})
const SILENT_STATUS = Object.freeze({ speak: 'SILENT_MISSED', silent: 'SILENT_OK' })
const REQUIRED_CASE_KEYS = Object.freeze(['id', 'class', 'mode', 'expect', 'message', 'reply'])
const DEFAULT_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'note-voice-baseline',
  'cases.json',
)

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function statusCounts() {
  const counts = {}
  for (const status of CASE_STATUS) counts[status] = 0
  return counts
}

function invalidResult(id, className, extra) {
  return { id, class: className, ...extra, status: 'INVALID', gated: false }
}

/**
 * Score one fixture case at the admitted level.
 *
 * `reply` is an already-parsed reviewer reply object, or null for no reply.
 * A malformed reply is INVALID. A silent reply is never a pass for a speak
 * case. A reply dropped by `admitsVerdict` is scored on the silence side and
 * flagged `gated`. A reply that clears the mode gate but fails verbatim
 * grounding is dropped quietly, exactly as the runtime drops it, so its status
 * is the silence-side one without the gate flag.
 *
 * @param caseDef - the fixture case.
 * @returns { id, class, status, gated, entail?, becauseGrounded? }.
 */
export function scoreCase(caseDef) {
  if (!isPlainObject(caseDef)) {
    return invalidResult(undefined, UNCLASSIFIED_CLASS)
  }
  const id = caseDef.id
  const className = typeof caseDef.class === 'string' ? caseDef.class : UNCLASSIFIED_CLASS
  const base = { id, class: className }
  const extra = {}
  if (caseDef.entail !== undefined) {
    const entail = ENTAIL_BY_LABEL[caseDef.entail]
    if (entail === undefined) return invalidResult(id, className)
    extra.entail = entail
  }
  if (!EXPECTATIONS.includes(caseDef.expect)) return invalidResult(id, className, extra)
  if (!Object.prototype.hasOwnProperty.call(caseDef, 'reply') || caseDef.reply === undefined) {
    return invalidResult(id, className, extra)
  }
  if (caseDef.reply === null) {
    return { ...base, ...extra, status: SILENT_STATUS[caseDef.expect], gated: false }
  }
  if (!isPlainObject(caseDef.reply)) return invalidResult(id, className, extra)

  const parsed = parseVerdict(JSON.stringify(caseDef.reply))
  if (parsed !== null && typeof parsed.because === 'string') {
    extra.becauseGrounded =
      typeof caseDef.message === 'string' && caseDef.message.includes(parsed.because)
  }
  if (parsed === null) return invalidResult(id, className, extra)
  if (parsed.note === null) {
    return { ...base, ...extra, status: SILENT_STATUS[caseDef.expect], gated: false }
  }

  // The gate is evaluated on the parsed reply, before grounding, so a mode
  // suppression is still visible when the reply also lacks a verbatim quote.
  if (!admitsVerdict(caseDef.mode, parsed)) {
    return { ...base, ...extra, status: SILENT_STATUS[caseDef.expect], gated: true }
  }
  if (groundVerdict(parsed, caseDef.message) === null) {
    return { ...base, ...extra, status: SILENT_STATUS[caseDef.expect], gated: false }
  }
  return {
    ...base,
    ...extra,
    status: caseDef.expect === 'speak' ? 'SPEAK_OK' : 'SPEAK_UNWARRANTED',
    gated: false,
  }
}

/**
 * Count results per class. Every known class is initialized, so a class with no
 * cases is visible as zero rather than missing. An unknown case class falls
 * into `unclassified` and is never merged into a known class.
 *
 * @param results - scored case results.
 * @returns { total, byClass, gated, invalid }.
 */
export function summarize(results) {
  const list = Array.isArray(results) ? results : []
  const byClass = {}
  for (const className of [...BASELINE_CLASSES, UNCLASSIFIED_CLASS]) {
    byClass[className] = statusCounts()
  }
  let gated = 0
  let invalid = 0
  for (const result of list) {
    const className =
      isPlainObject(result) && BASELINE_CLASSES.includes(result.class)
        ? result.class
        : UNCLASSIFIED_CLASS
    if (isPlainObject(result) && CASE_STATUS.includes(result.status)) {
      byClass[className][result.status] += 1
    }
    if (isPlainObject(result) && result.gated === true) gated += 1
    if (isPlainObject(result) && result.status === 'INVALID') invalid += 1
  }
  return { total: list.length, byClass, gated, invalid }
}

function missingRequiredKeys(entry) {
  if (!isPlainObject(entry)) return [...REQUIRED_CASE_KEYS]
  return REQUIRED_CASE_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(entry, key))
}

function refusedResult(entry) {
  const id = isPlainObject(entry) ? entry.id : undefined
  const className =
    isPlainObject(entry) && typeof entry.class === 'string' ? entry.class : UNCLASSIFIED_CLASS
  return { id, class: className, status: 'INVALID', gated: false }
}

function formatTable(counts) {
  const classWidth = 30
  const statusWidth = 18
  const header =
    'class'.padEnd(classWidth) + CASE_STATUS.map((status) => status.padStart(statusWidth)).join('')
  const rows = [...BASELINE_CLASSES, UNCLASSIFIED_CLASS].map((className) => {
    const bucket = counts.byClass[className]
    return (
      className.padEnd(classWidth) +
      CASE_STATUS.map((status) => String(bucket[status]).padStart(statusWidth)).join('')
    )
  })
  return [header, ...rows].join('\n')
}

function readCases(fixturePath) {
  const parsed = JSON.parse(readFileSync(fixturePath, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('the fixture file must contain an array of cases')
  return parsed
}

/**
 * Run the offline CLI. A structurally incomplete case is refused, reported as
 * INVALID, and makes the process exit non-zero; no threshold or score does.
 */
function main(argv) {
  const fixturePath = argv[2] ? resolve(argv[2]) : DEFAULT_FIXTURE_PATH
  let cases
  try {
    cases = readCases(fixturePath)
  } catch (error) {
    console.error('cannot read fixtures at ' + fixturePath + ': ' + error.message)
    process.exitCode = 2
    return
  }
  const results = cases.map((entry, index) => {
    const missing = missingRequiredKeys(entry)
    if (missing.length === 0) return scoreCase(entry)
    const id = isPlainObject(entry) && typeof entry.id === 'string' ? ' (' + entry.id + ')' : ''
    console.error('refusing case ' + (index + 1) + id + ': missing ' + missing.join(', '))
    return refusedResult(entry)
  })
  const counts = summarize(results)
  console.log(BASELINE_VERSION + ': ' + counts.total + ' cases')
  console.log(formatTable(counts))
  console.log('gated: ' + counts.gated)
  console.log('invalid: ' + counts.invalid)
  console.log('baseline is unvalidated until the owner sets a threshold')
  if (counts.invalid > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) main(process.argv)
