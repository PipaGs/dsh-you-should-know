// Adaptive reviewer profile for dsh-you-should-know.
//
// This module is deliberately dependency-free and pure. It reads only the
// already-filtered visible conversation messages (human user and visible
// assistant text) and derives two plugin-owned additions to the reviewer
// instruction: a fixed response-language directive and a bounded set of
// language-specific correctness skills. It never reads tool results,
// system or project instructions, hidden events, or the raw session log, and
// it never copies text from the conversation into the instruction.

/** Hard ceiling on language skills appended to one reviewer call. */
export const MAX_REVIEW_SKILLS = 3

// Canonical language order. It is the stable tie-break for equal evidence and
// the order in which at most MAX_REVIEW_SKILLS skills are selected.
const SUPPORTED_LANGUAGES = Object.freeze([
  'JavaScript',
  'TypeScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'Kotlin',
  'C',
  'C++',
  'C#',
  'Swift',
  'PHP',
  'Ruby',
  'Shell',
  'SQL',
  'HTML',
  'CSS',
])

// One normalized alias table for both fenced language tags and file
// extensions. Every key is lowercased; values are the canonical names above.
// Unknown aliases are ignored, so detection never guesses from a bare word.
const LANGUAGE_ALIASES = new Map([
  ['js', 'JavaScript'],
  ['javascript', 'JavaScript'],
  ['mjs', 'JavaScript'],
  ['cjs', 'JavaScript'],
  ['jsx', 'JavaScript'],
  ['node', 'JavaScript'],
  ['nodejs', 'JavaScript'],
  ['ts', 'TypeScript'],
  ['typescript', 'TypeScript'],
  ['tsx', 'TypeScript'],
  ['mts', 'TypeScript'],
  ['cts', 'TypeScript'],
  ['py', 'Python'],
  ['python', 'Python'],
  ['python3', 'Python'],
  ['go', 'Go'],
  ['golang', 'Go'],
  ['rs', 'Rust'],
  ['rust', 'Rust'],
  ['java', 'Java'],
  ['kt', 'Kotlin'],
  ['kotlin', 'Kotlin'],
  ['kts', 'Kotlin'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['c++', 'C++'],
  ['cc', 'C++'],
  ['cxx', 'C++'],
  ['hpp', 'C++'],
  ['hxx', 'C++'],
  ['cs', 'C#'],
  ['csharp', 'C#'],
  ['c#', 'C#'],
  ['swift', 'Swift'],
  ['php', 'PHP'],
  ['rb', 'Ruby'],
  ['ruby', 'Ruby'],
  ['sh', 'Shell'],
  ['bash', 'Shell'],
  ['zsh', 'Shell'],
  ['shell', 'Shell'],
  ['ksh', 'Shell'],
  ['sql', 'SQL'],
  ['html', 'HTML'],
  ['htm', 'HTML'],
  ['xhtml', 'HTML'],
  ['css', 'CSS'],
  ['scss', 'CSS'],
  ['sass', 'CSS'],
  ['less', 'CSS'],
])

// Concise, high-signal defect checklists. These are correctness skills, not
// style guides: each entry names a defect that can materially change behavior.
const REVIEW_SKILLS = new Map([
  ['JavaScript', [
    'an unhandled promise rejection or an async error that never reaches a caller',
    'a listener, timer, or subscription left attached after its owner is gone',
    'a stale closure over mutated state, or a race between two await points',
    'a value whose runtime type or shape contradicts how it is used',
    'a module or package boundary problem: a missing export, a deep internal import, or an import side effect',
  ]],
  ['TypeScript', [
    'an async/promise error flow that drops or double-handles a rejection',
    'a type assertion or non-null assertion that hides a real runtime possibility',
    'a runtime value that disagrees with its declared type',
    'a listener, subscription, or timer that is not cleaned up across an async boundary',
    'a stale closure or a race between concurrent awaits',
    'a module or package boundary problem: a type-only import used as a value, or a missing export',
  ]],
  ['Python', [
    'an async function that blocks the event loop, or a sync/async mismatch at a call boundary',
    'a mutable default or shared module-level state mutated across calls',
    'a file, lock, or connection used outside its context-manager lifetime',
    'an exception that is swallowed or re-raised with its cause and type lost',
    'a runtime value that violates a declared type or an assumed None invariant',
  ]],
  ['Go', [
    'a goroutine or channel that outlives its caller and leaks',
    'missing or wrong context cancellation propagation',
    'an error that is ignored, overwritten, or compared with the wrong identity',
    'a data race, or a shared map or slice mutated without synchronization',
    'a deferred call or resource close ordered after the value it protects',
  ]],
  ['Rust', [
    'an ownership or lifetime assumption that cannot hold at the call site',
    'an unsafe block whose safety invariant is not established',
    'a panic path where callers expect a Result, or an erased error type',
    'a Send/Sync assumption violated by a shared handle or thread',
    'a resource or lock lifetime that outlives its intended scope',
  ]],
  ['Java', [
    'a value that can be null and is dereferenced or returned unchecked',
    'shared mutable state accessed without a happens-before edge',
    'a lifecycle or resource that is not closed on every path',
    'an exception swallowed, misclassified, or thrown from the wrong boundary',
    'an API contract mismatch: a declared return, checked exception, or override',
  ]],
  ['Kotlin', [
    'a nullable value forced with !! or used without a null branch',
    'a coroutine scope, structured concurrency, or cancellation that is not propagated',
    'shared mutable state accessed without synchronization',
    'a closeable resource that is not released on every path',
    'a Java interop nullability or API contract mismatch',
  ]],
  ['C', [
    'a memory lifetime defect: use-after-free, double free, or ownership not transferred',
    'a buffer bound or length arithmetic that can overrun',
    'undefined behavior: signed overflow, strict aliasing, or unsequenced access',
    'shared state or signal-handler access without synchronization',
    'a file descriptor, lock, or resource that is not released on an error path',
  ]],
  ['C++', [
    'an object lifetime or ownership defect: a dangling reference, a double free, or a missed move',
    'an iterator or reference invalidated by container mutation or reallocation',
    'undefined behavior: bounds, signed overflow, object lifetime, or aliasing',
    'a data race or a lock-ordering problem on shared state',
    'RAII resource cleanup bypassed on an early return or an exception',
  ]],
  ['C#', [
    'a value that can be null and is dereferenced without a null branch',
    'an async/await error flow or an unobserved Task',
    'shared mutable state accessed without synchronization',
    'an IDisposable or unmanaged resource that is not released on every path',
    'an exception semantic or API contract mismatch',
  ]],
  ['Swift', [
    'a force unwrap or implicit optional dereference that can trap at runtime',
    'an async task whose cancellation or error is not propagated',
    'shared mutable state accessed without isolation',
    'a resource or lifecycle object that is not released on every path',
    'an API contract or protocol conformance mismatch',
  ]],
  ['PHP', [
    'a value that can be null or of the wrong type and is used unchecked',
    'an exception or error that is swallowed instead of propagated',
    'a database transaction that is not closed on every path',
    'a resource or file handle that is not released on an error path',
    'an SQL or template boundary where untrusted input is not parameterized or escaped',
  ]],
  ['Ruby', [
    'a value that can be nil and is dereferenced or returned unchecked',
    'an exception rescue that swallows the error or hides its cause',
    'a resource or file handle that is not released on every path',
    'shared mutable state accessed from more than one thread without synchronization',
    'a metaprogramming or API contract mismatch that changes behavior at runtime',
  ]],
  ['Shell', [
    'an unquoted expansion that causes word splitting, globbing, or injection',
    'a pipe or command failure that is not propagated (set -e or pipefail semantics)',
    'a destructive path or glob that can expand beyond the intended target',
    'a portability assumption: a non-POSIX option, builtin, or shell feature',
    'a secret exposed through arguments, history, the environment, or logs',
  ]],
  ['SQL', [
    'a missing transaction boundary, or a write that commits partially',
    'an isolation or locking choice that allows a lost update or a read anomaly',
    'a NULL comparison or aggregate semantic treated as a boolean',
    'a destructive statement whose scope is wider than intended',
    'a query correctness or injection defect: unparameterized input or a wrong join cardinality',
  ]],
  ['HTML', [
    'an accessibility or semantics break: a missing role or label, a wrong element, or a broken focus order',
    'content or attribute injection from untrusted data',
    'an interactive element that loses keyboard or assistive-technology support',
    'a resource or navigation that breaks under a different base URL',
  ]],
  ['CSS', [
    'a layout overflow or responsiveness defect that hides or clips content',
    'a z-index or stacking context that obscures interactive content',
    'a browser-compatibility gap that changes behavior in a supported target',
    'a selector or specificity change that silently overrides intended styles',
  ]],
])

// Fixed, context-relative directive. It intentionally names no locale: the
// reviewer resolves the natural language from the excerpt itself.
const RESPONSE_LANGUAGE_DIRECTIVE = [
  'Response language: write the note in the same natural language as the latest genuine human user message in the excerpt.',
  'If that message is code-only or its language is unclear, use the language of the nearest earlier genuine human user message; if it is still unclear, use English.',
  'Keep the JSON object keys (note, importance, source, action) and the high/critical importance values exactly as specified; do not translate them.',
].join(' ')

const NO_STYLE_DIRECTIVE =
  'These are correctness skills only. Do not raise style, formatting, lint, naming, or preference advice.'

// Markdown fenced code with an info-string language token. Only an opening
// fence carries a language, so a closing fence never contributes evidence.
const FENCE_PATTERN = /(?:^|\n)[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z][\w+#.-]*)/g

// A path or file token with an extension, anchored to start/whitespace/quote
// so a mid-word dot is not treated as a file mention.
const FILE_TOKEN_PATTERN = /(?:^|[\s"'`(<\[])([\w@~./\\-]+\.[A-Za-z][\w+#-]*)/g

/** Normalize one alias to a canonical language name, or undefined. */
function canonicalOf(alias) {
  if (typeof alias !== 'string' || alias === '') return undefined
  return LANGUAGE_ALIASES.get(alias.toLowerCase())
}

/** Fenced language tags present in visible text, in reading order. */
function fencedLanguages(text) {
  const found = []
  FENCE_PATTERN.lastIndex = 0
  let match
  while ((match = FENCE_PATTERN.exec(text)) !== null) {
    const language = canonicalOf(match[1])
    if (language !== undefined) found.push(language)
  }
  return found
}

/** File-extension languages mentioned in visible text, in reading order. */
function extensionLanguages(text) {
  const found = []
  FILE_TOKEN_PATTERN.lastIndex = 0
  let match
  while ((match = FILE_TOKEN_PATTERN.exec(text)) !== null) {
    const token = match[1]
    const dot = token.lastIndexOf('.')
    if (dot < 0) continue
    const language = canonicalOf(token.slice(dot + 1))
    if (language !== undefined) found.push(language)
  }
  return found
}

/** Visible text of one already-filtered message, or undefined for anything else. */
function visibleTextOf(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  if (entry.role !== 'user' && entry.role !== 'assistant') return undefined
  return typeof entry.text === 'string' ? entry.text : undefined
}

/**
 * Detect the programming languages in the bounded visible conversation.
 *
 * Only already-filtered visible messages are read: a human user or visible
 * assistant entry. Tool results, system/project instructions, and hidden
 * events carry no user/assistant role here and are ignored even if a caller
 * passes a raw event list. Detection is deterministic: an explicit fenced
 * language tag outranks a file-extension mention, common keywords never
 * select a language, and at most MAX_REVIEW_SKILLS languages are returned.
 *
 * @param messages - visible message entries shaped like { role, text }.
 * @returns canonical language names, most reliable first.
 */
export function detectReviewLanguages(messages) {
  if (!Array.isArray(messages)) return []
  const fenceEvidence = new Map()
  const extensionEvidence = new Map()
  for (const entry of messages) {
    const text = visibleTextOf(entry)
    if (text === undefined || text === '') continue
    for (const language of fencedLanguages(text)) {
      fenceEvidence.set(language, (fenceEvidence.get(language) || 0) + 1)
    }
    for (const language of extensionLanguages(text)) {
      extensionEvidence.set(language, (extensionEvidence.get(language) || 0) + 1)
    }
  }
  const candidates = []
  for (const language of SUPPORTED_LANGUAGES) {
    const fence = fenceEvidence.get(language) || 0
    const extension = extensionEvidence.get(language) || 0
    if (fence === 0 && extension === 0) continue
    candidates.push({ language, fence, extension })
  }
  candidates.sort((left, right) => {
    if ((left.fence > 0) !== (right.fence > 0)) return left.fence > 0 ? -1 : 1
    const leftWeight = left.fence * 2 + left.extension
    const rightWeight = right.fence * 2 + right.extension
    if (leftWeight !== rightWeight) return rightWeight - leftWeight
    return SUPPORTED_LANGUAGES.indexOf(left.language) - SUPPORTED_LANGUAGES.indexOf(right.language)
  })
  return candidates.slice(0, MAX_REVIEW_SKILLS).map((candidate) => candidate.language)
}

/**
 * Resolve the concise defect checklist for each supported language.
 * Unknown ids are skipped, never fabricated.
 *
 * @param languages - canonical language names.
 * @returns skill objects with a language and its checklist.
 */
export function reviewSkillsFor(languages) {
  if (!Array.isArray(languages)) return []
  const skills = []
  for (const language of languages) {
    if (skills.length >= MAX_REVIEW_SKILLS) break
    const checks = REVIEW_SKILLS.get(language)
    if (checks === undefined) continue
    skills.push({ language, checks: checks.slice() })
  }
  return skills
}

/**
 * Build the plugin-owned profile section appended to the reviewer policy.
 * The response-language directive is always present; the skill block appears
 * only when a language was reliably detected.
 *
 * @param messages - visible message entries shaped like { role, text }.
 * @returns the section text, or an empty string for a malformed input.
 */
export function buildReviewProfileSection(messages) {
  const skills = reviewSkillsFor(detectReviewLanguages(messages))
  const lines = [RESPONSE_LANGUAGE_DIRECTIVE]
  if (skills.length > 0) {
    lines.push('')
    lines.push('Active review skills:')
    for (const skill of skills) {
      lines.push('- ' + skill.language + ': ' + skill.checks.join('; ') + '.')
    }
    lines.push('')
    lines.push(NO_STYLE_DIRECTIVE)
  }
  return lines.join('\n')
}
