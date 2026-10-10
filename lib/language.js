// Effective output-language resolution for the reviewer and the explainer.
//
// This module is deliberately dependency-free and pure. It owns the one policy
// both trusted model calls share: the human-facing natural language of a note
// or an explanation. The priority is deterministic and testable:
//
//   1. an explicit host user-language setting, when the host exposes one;
//   2. the latest genuine human user message in the visible excerpt, which the
//      reviewer resolves itself (the existing behavior);
//   3. English.
//
// The host seam is injected by the plugin body: core.js never reaches for a
// host service, and a missing or unusable value simply falls through. Internal
// trusted prompts, JSON keys, and importance values stay English regardless.

/** The last-resort natural language when nothing else is known. */
export const FALLBACK_OUTPUT_LANGUAGE = 'English'

/** Longest accepted host language tag. Real BCP-47 tags stay far below this. */
export const MAX_LANGUAGE_TAG_CHARS = 35

// A bounded BCP-47-like tag: a primary subtag plus optional subtags. Only
// ASCII letters, digits, and single separators are accepted, so a hostile or
// accidental value (a sentence, markup, a control character, a shell fragment)
// is never copied into a prompt.
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/

// The reviewer's own reply contract. It is part of the language directive, so
// the key names and the importance values are never translated.
const REVIEW_JSON_KEYS = 'Keep the JSON object keys (note, importance, source, action) and the high/critical importance values exactly as specified; do not translate them.'

/**
 * Normalize one host language value.
 *
 * @param value - the raw host value, possibly absent or hostile.
 * @returns the normalized tag, or undefined when it is unusable.
 */
export function normalizeHostLanguage(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_LANGUAGE_TAG_CHARS) return undefined
  if (!LANGUAGE_TAG_PATTERN.test(trimmed)) return undefined
  return trimmed.replace(/_/g, '-')
}

/**
 * Whether the visible excerpt contains at least one genuine human message.
 *
 * @param messages - already-filtered visible entries shaped like { role, text }.
 * @returns true when a nonblank human user entry is present.
 */
export function hasGenuineHumanMessage(messages) {
  if (!Array.isArray(messages)) return false
  for (const entry of messages) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.role !== 'user') continue
    if (typeof entry.text !== 'string') continue
    if (entry.text.trim() !== '') return true
  }
  return false
}

/**
 * Resolve the effective output language and its source.
 *
 * @param options.hostLanguage - the host's explicit user-language setting.
 * @param options.messages - the already-filtered visible excerpt entries.
 * @returns { source, language }: source is host, human-message, or fallback.
 */
export function resolveOutputLanguage(options = {}) {
  const host = normalizeHostLanguage(options.hostLanguage)
  if (host !== undefined) return { source: 'host', language: host }
  if (hasGenuineHumanMessage(options.messages)) return { source: 'human-message', language: undefined }
  return { source: 'fallback', language: FALLBACK_OUTPUT_LANGUAGE }
}

/**
 * The bare response-language sentence for one trusted model call, naming the
 * artifact it governs (a note, an explanation).
 *
 * @param options.hostLanguage - the host's explicit user-language setting.
 * @param options.messages - the already-filtered visible excerpt entries.
 * @param options.subject - the artifact noun; defaults to "note".
 * @returns the language instruction sentence(s).
 */
export function languageSentenceFor(options = {}) {
  const subject = typeof options.subject === 'string' && options.subject !== '' ? options.subject : 'note'
  const resolved = resolveOutputLanguage(options)
  if (resolved.source === 'host') {
    return 'Response language: the host setting identifies the output language as "' + resolved.language + '". Write the ' + subject + ' in that language.'
  }
  if (resolved.source === 'human-message') {
    return 'Response language: write the ' + subject + ' in the same natural language as the latest genuine human user message in the excerpt. ' +
      'If that message is code-only or its language is unclear, use the language of the nearest earlier genuine human user message; if it is still unclear, use English.'
  }
  return 'Response language: no genuine human user message is present, so write the ' + subject + ' in English.'
}

/**
 * The full reviewer response-language directive: the resolved language
 * sentence plus the untranslatable JSON reply contract.
 *
 * @param options.hostLanguage - the host's explicit user-language setting.
 * @param options.messages - the already-filtered visible excerpt entries.
 * @returns the directive text.
 */
export function languageDirectiveFor(options = {}) {
  return languageSentenceFor({ ...options, subject: options.subject ?? 'note' }) + ' ' + REVIEW_JSON_KEYS
}
