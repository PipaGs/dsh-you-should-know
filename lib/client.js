// Browser half of dsh-you-should-know.
//
// Registered as a lazy CommonJS factory in the Web client's module table. It
// renders three human-only surfaces and never writes to the conversation
// transcript: the compact "You should know" note card above the composer, a
// fetch-backed settings card in the Plugins settings page, and a compact
// reviewer action in the conversation session header. It polls only the note
// route, and only while the page is visible.

window.__ModuleLoader__.load({
  id: 'dsh-you-should-know',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const POLL_MS = 7000
    // The Desktop loads the app from the dsh-app://app/ origin and proxies
    // /api to the host. Document-relative URLs resolve against that origin
    // (dsh-app://app/api/...); an origin-root absolute path would not.
    const NOTES_URL = 'api/dsh-you-should-know/notes'
    const HISTORY_URL = 'api/dsh-you-should-know/history'
    const DISMISS_URL = 'api/dsh-you-should-know/dismiss'
    const CONFIG_URL = 'api/dsh-you-should-know/config'
    const SESSION_URL = 'api/dsh-you-should-know/session'
    const UPDATE_URL = 'api/dsh-you-should-know/update'
    const EXPLAIN_URL = 'api/dsh-you-should-know/explain'
    const SELF_CHECK_URL = 'api/dsh-you-should-know/self-check'
    // Matches the host's maxTrackedSessions so the page-lifetime memory cannot
    // outgrow the host table it mirrors.
    const MAX_RESOLVED_SESSIONS = 200
    // The rendered stack mirrors the host's hard per-session note budget, so the
    // page can never render more notes than one session is allowed to hold.
    const MAX_RENDERED_NOTES = 12
    // Mirrors the host parser's source bounds: a hostile or stale payload must
    // not become a link.
    const MAX_SOURCE_PATH_CHARS = 400
    const MAX_SOURCE_LINE = 1000000
    // Mirrors the host parser's action bound: a hostile or stale payload must
    // not paste an unbounded instruction into the composer.
    const MAX_ACTION_CHARS = 600

    const AUTOMATIC_DESCRIPTION = 'Picks the cheapest registered DeepSeek route when a turn qualifies; stays quiet when this build mounts none.'

    // The three update behaviors, in display order. Current DSH exposes no
    // approved plugin update API, so on this build only Notify only is fully
    // effective: Ask before update degrades to the same notice, and Automatic
    // stores the preference but never mutates an installation.
    const UPDATE_BEHAVIOR_OPTIONS = Object.freeze([
      { id: 'notify-only', label: 'Notify only', description: 'Shows a notice when a newer release exists. Nothing is installed automatically.' },
      { id: 'ask-before-update', label: 'Ask before update', description: 'This DSH version has no approved plugin update API, so this behaves like Notify only: you approve and install from the Plugins settings.' },
      { id: 'automatic', label: 'Automatic', description: 'Automatic installation is not supported by this DSH version.' },
    ])
    const DEFAULT_UPDATE_BEHAVIOR = 'ask-before-update'
    const DEFAULT_UPDATE_STATUS = Object.freeze({
      currentVersion: '',
      latestVersion: '',
      latestTag: '',
      installSpec: '',
      source: 'git-tags',
      updateAvailable: false,
      dismissed: false,
      dismissedVersion: '',
      autoCheckUpdates: true,
      updateBehavior: DEFAULT_UPDATE_BEHAVIOR,
      automaticSupported: false,
      lastAutoCheckDate: '',
      lastCheckedAt: null,
      lastResult: null,
    })

    /** The option for one update-behavior id; an unknown id falls back to Ask. */
    function updateBehaviorOption(id) {
      for (const option of UPDATE_BEHAVIOR_OPTIONS) {
        if (option.id === id) return option
      }
      return UPDATE_BEHAVIOR_OPTIONS[1]
    }

    // The five stable reviewer modes, in display order: the settings select and
    // the session override select both read this table, and each mode carries
    // the one-line helper the settings card shows below the select.
    const REVIEW_MODE_OPTIONS = Object.freeze([
      { id: 'relaxed', label: 'Relaxed', description: 'Only obvious, material problems: real bugs, violated requirements, security or data-loss risks.' },
      { id: 'balanced', label: 'Balanced', description: 'Material overlooked problems, including bugs, invalid states, API contract errors, and important test gaps.' },
      { id: 'strict', label: 'Strict', description: 'Balanced plus edge cases, stale state, races, exception paths, and missing tests.' },
      { id: 'paranoid', label: 'Paranoid', description: 'Aggressively searches hidden failure modes and regressions across concurrency, lifecycle, and boundaries.' },
      { id: 'custom', label: 'Custom', description: 'Shaped by your saved Custom reviewer prompt, which replaces the strictness profile; blank falls back to Balanced.' },
    ])
    const DEFAULT_REVIEW_MODE = 'balanced'

    // Mirrors the host default so a stale payload that omits the field still
    // renders and posts a valid, conservative budget.
    const DEFAULT_MAX_REVIEWER_CALLS_PER_HOUR = 12

    /** The option for one mode id; an unknown id falls back to Balanced. */
    function reviewModeOption(id) {
      for (const option of REVIEW_MODE_OPTIONS) {
        if (option.id === id) return option
      }
      return REVIEW_MODE_OPTIONS[1]
    }

    // The narrow reactive store behind the connection/reset flag. Every
    // host-backed surface refreshes on a reconnect, and a component that is not
    // mounted participates in nothing.
    function createChannelStore() {
      const listeners = new Set()
      let snapshot = false
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        read() {
          return snapshot
        },
        toggle() {
          snapshot = snapshot !== true
          for (const listener of [...listeners]) listener()
        },
      }
    }

    const connectionReset = createChannelStore()

    // Page-lifetime, per-session resolution memory: the host keeps serving a
    // note until the resolve reaches it, and this set stops a just-resolved note
    // reappearing on the next poll. Both resolutions share it: a manual dismiss
    // and a successful Add to chat. The table is bounded: the oldest session is
    // evicted when a new one would exceed the cap, which preserves recent-session
    // behavior without growing for the life of the page.
    const resolvedBySession = new Map()

    function resolvedSet(sessionId) {
      let set = resolvedBySession.get(sessionId)
      if (set === undefined) {
        set = new Set()
        resolvedBySession.set(sessionId, set)
        if (resolvedBySession.size > MAX_RESOLVED_SESSIONS) {
          resolvedBySession.delete(resolvedBySession.keys().next().value)
        }
      }
      return set
    }

    /** The active notes plus the bounded history count, or null when unavailable. */
    async function fetchNotes(sessionId) {
      try {
        const response = await fetch(`${NOTES_URL}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (!payload || payload.ok !== true || !Array.isArray(payload.notes)) return null
        const count = Number.isInteger(payload.historyCount) && payload.historyCount >= 0 ? payload.historyCount : 0
        return { notes: payload.notes, historyCount: count }
      } catch (error) {
        return null
      }
    }

    /** Read one session's bounded notification history, or null when unavailable. */
    async function fetchHistory(sessionId) {
      try {
        const response = await fetch(`${HISTORY_URL}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (!payload || payload.ok !== true || !Array.isArray(payload.history)) return null
        return payload.history.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.note === 'string')
      } catch (error) {
        return null
      }
    }

    /** Post exactly one resolution transition. Best effort: local state already moved. */
    function resolveOnHost(sessionId, noteId, action) {
      try {
        fetch(DISMISS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, noteId, action }),
          cache: 'no-store',
          keepalive: true,
        }).catch(() => {})
      } catch (error) {
        // Best effort: the local resolution above already hid the note.
      }
    }

    /**
     * Request one bounded explanation for a stored finding. Returns
     * { ok, explanation }, { ok: false, error }, or null on transport failure;
     * the caller renders loading, error, and retry without blocking anything.
     */
    async function fetchExplain(sessionId, noteId) {
      try {
        const response = await fetch(EXPLAIN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, noteId }),
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => null)
        if (payload === null || typeof payload !== 'object') return null
        if (payload.ok === true && typeof payload.explanation === 'string' && payload.explanation !== '') {
          return { ok: true, explanation: payload.explanation }
        }
        return { ok: false, error: typeof payload.error === 'string' ? payload.error : 'failed' }
      } catch (error) {
        return null
      }
    }

    /** Read the bounded config payload, or null when it is unavailable. */
    async function fetchConfig() {
      try {
        const response = await fetch(CONFIG_URL, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (!payload || payload.ok !== true || !payload.config || typeof payload.config !== 'object') return null
        return payload
      } catch (error) {
        return null
      }
    }

    /** Read one session's bounded reviewer view, or null when unavailable. */
    async function fetchSession(sessionId) {
      try {
        const response = await fetch(`${SESSION_URL}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (!payload || payload.ok !== true) return null
        return payload
      } catch (error) {
        return null
      }
    }

    /** Post exactly one bounded session action. */
    async function postSession(body) {
      try {
        const response = await fetch(SESSION_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        })
        if (response.ok !== true) return null
        return await response.json()
      } catch (error) {
        return null
      }
    }

    /** Post the bounded config for one reviewer route. */
    async function postConfig(payload) {
      try {
        const response = await fetch(CONFIG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        })
        const body = await response.json().catch(() => null)
        return { ok: response.ok === true, body }
      } catch (error) {
        return { ok: false, body: null }
      }
    }

    /**
     * Read the authenticated self-check payload, or null when it is
     * unavailable. The request is a document-relative same-origin GET, so the
     * browser attaches the DSH session the same way it does for every other
     * plugin route; this code never touches a cookie, token, or header.
     */
    async function fetchSelfCheck() {
      try {
        const response = await fetch(SELF_CHECK_URL, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
        return payload
      } catch (error) {
        return null
      }
    }

    /**
     * Compare the running module version with the installed package version.
     * Returns 'current', 'restart-required', or 'unavailable'; it never guesses
     * when either side is missing.
     */
    function restartState(runningVersion, installedVersion) {
      const running = typeof runningVersion === 'string' && runningVersion !== '' ? runningVersion : null
      const installed = typeof installedVersion === 'string' && installedVersion !== '' ? installedVersion : null
      if (running === null || installed === null) return 'unavailable'
      return running === installed ? 'current' : 'restart-required'
    }

    /** The enabled capability names in one bounded line, or a neutral fallback. */
    function enabledCapabilities(payload) {
      const capabilities = payload !== null && typeof payload.capabilities === 'object' && payload.capabilities !== null ? payload.capabilities : {}
      const names = []
      for (const name of Object.keys(capabilities)) {
        if (capabilities[name] === true) names.push(name)
      }
      return names.length === 0 ? 'none reported' : names.join(', ')
    }

    /**
     * Explain a not-healthy self-check from the bounded fields the route
     * returns: whether the reviewer is configured, which routes lack a handler,
     * and the aggregate runtime status. It never invents a reason.
     */
    function selfCheckReason(payload) {
      const reasons = []
      if (payload.configured !== true) reasons.push('the reviewer route is not configured')
      const routes = Array.isArray(payload.routes) ? payload.routes : []
      const unregistered = routes
        .filter((route) => route !== null && typeof route === 'object' && route.registered === false && typeof route.name === 'string')
        .map((route) => route.name)
      if (unregistered.length > 0) reasons.push(`unregistered routes: ${unregistered.join(', ')}`)
      if (typeof payload.runtimeStatus === 'string' && payload.runtimeStatus !== 'idle' && payload.runtimeStatus !== 'reviewing') reasons.push(`runtime status is ${payload.runtimeStatus}`)
      return reasons.length === 0 ? 'No specific reason was reported.' : reasons.join('; ') + '.'
    }

    /** Providers advertised by the bounded catalog. */
    function catalogProviders(catalog) {
      if (!catalog || !Array.isArray(catalog.providers)) return []
      return catalog.providers.filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
    }

    function catalogModels(catalog, provider) {
      const found = catalogProviders(catalog).find((entry) => entry.id === provider)
      return found && Array.isArray(found.models) ? found.models.filter((model) => typeof model === 'string' && model !== '') : []
    }

    function fieldValue(event) {
      return event && event.target ? event.target.value : event
    }

    function checkedValue(event) {
      return event && event.target ? event.target.checked === true : event === true
    }

    /** The label for the effective route source in the session header action. */
    function sourceLabel(source) {
      if (source === 'session') return 'This session'
      if (source === 'global') return 'Global'
      return 'Automatic'
    }

    function routeSummary(route) {
      if (!route || typeof route.provider !== 'string' || typeof route.model !== 'string') return 'Automatic'
      return `${route.provider}/${route.model}`
    }

    /**
     * Whether one reviewer path is an exact filesystem path. A Windows drive
     * path is a path; any other `scheme:`-prefixed string is a URL and is never
     * opened. This mirrors the host parser, because the card must not trust a
     * stale or unexpected payload.
     */
    function isFilesystemPath(value) {
      if (/^[A-Za-z]:[\\/]/.test(value)) return true
      return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
    }

    /** The validated `{ path, line? }` a card may render, or null. */
    function noteSourceOf(note) {
      const source = note && note.source
      if (source === null || typeof source !== 'object' || Array.isArray(source)) return null
      if (typeof source.path !== 'string') return null
      const path = source.path.trim()
      if (path === '' || path.length > MAX_SOURCE_PATH_CHARS) return null
      if (/[\u0000-\u001f\u007f]/.test(path)) return null
      if (!isFilesystemPath(path)) return null
      const line = source.line
      if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > MAX_SOURCE_LINE) return { path }
      return { path, line }
    }

    /** `path` or `path:line`; the line suffix appears only when it is known. */
    function sourceLabel(source) {
      return source.line === undefined ? source.path : `${source.path}:${source.line}`
    }

    /**
     * The `dsh-resource://file/session/<id>/<path>` address of one note source.
     * The grammar is public and owned by @deepseek-ai/dsh-util-workspace-path;
     * this browser bundle has no build step, so it mirrors `sessionFileAddress`
     * rather than importing it. The path is data: it is encoded segment by
     * segment and never becomes a URL of another kind.
     */
    function sessionFileAddress(sessionId, path) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      const encode = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':')
      const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `dsh-resource://file/session/${encode(sessionId)}/${normalized.split('/').map(encode).join('/')}`
    }

    /**
     * The bounded, host-validated agent-facing repair instruction one note may
     * carry, or the empty string. The client re-checks the host's bound because
     * the card must not trust a stale or hostile payload.
     */
    function noteActionOf(note) {
      const action = note && note.action
      if (typeof action !== 'string') return ''
      const trimmed = action.trim()
      if (trimmed === '' || trimmed.length > MAX_ACTION_CHARS) return ''
      return trimmed
    }

    // A character that can continue a path token. If one touches a match of the
    // source path, the action is naming a longer token (for example
    // `src/a.js.map`), not this exact path.
    const PATH_EDGE = /[A-Za-z0-9_./\\~@+#-]/

    /** Whether the action names the exact source path as a whole token. */
    function namesSourcePath(action, path) {
      let index = action.indexOf(path)
      while (index !== -1) {
        const before = index === 0 ? '' : action[index - 1]
        const after = index + path.length >= action.length ? '' : action[index + path.length]
        if (!PATH_EDGE.test(before) && !PATH_EDGE.test(after)) return true
        index = action.indexOf(path, index + 1)
      }
      return false
    }

    /**
     * The exact composer text one note contributes. When the finding carries an
     * agent-facing action, that instruction is the draft and the human note
     * stays on the card. The source is appended as a separate line only when the
     * action does not already name the exact path. A finding without an action
     * falls back to an imperative wrapper around the human note, so an old note
     * still yields a repair request instead of the notification prose alone.
     */
    function noteDraft(note) {
      const source = noteSourceOf(note)
      const action = noteActionOf(note)
      if (action !== '') {
        return source !== null && !namesSourcePath(action, source.path)
          ? action + '\n' + `File: ${sourceLabel(source)}`
          : action
      }
      const lines = [`Fix this reviewer finding: ${note.note}`]
      if (source !== null) lines.push(`File: ${sourceLabel(source)}`)
      return lines.join('\n')
    }

    /**
     * Append one note to the composer draft without ever sending it. The
     * canonical public seam for a programmatic draft write is
     * `InputActions.setDraft(text)`: it replaces the whole draft atomically and
     * carries no capture/insert revision, so a later Enter submits the draft
     * instead of replaying this edit. `captureInsertion()`/`insertText()` is the
     * deferred-insertion seam for asynchronous consumers (voice input), not a
     * direct draft write.
     *
     * @returns whether the draft accepted the edit.
     */
    function addNoteToDraft(note, inputActions, input) {
      if (!inputActions || typeof inputActions.setDraft !== 'function') return false
      const text = noteDraft(note)
      const draft = input && typeof input.draft === 'string' ? input.draft : ''
      try {
        inputActions.setDraft(draft.trim() === '' ? text : `${draft}\n\n${text}`)
        return true
      } catch (error) {
        return false
      }
    }

    /**
     * Keep the composer's focus when a card control is pressed. The DSH composer
     * does the same for its own toolbar buttons; without it the pressed button
     * keeps DOM focus and a following Enter re-activates the button (replaying
     * Add to chat) instead of reaching the draft's submit keymap.
     */
    function keepComposerFocus(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
    }

    /**
     * The notes one card renders: oldest first, so the newest finding sits
     * nearest the composer, bounded like the host per-session budget.
     */
    function orderNoteCards(notes) {
      const ordered = [...notes].sort((left, right) => {
        const a = typeof left.createdAt === 'number' ? left.createdAt : 0
        const b = typeof right.createdAt === 'number' ? right.createdAt : 0
        return a - b
      })
      return ordered.slice(-MAX_RENDERED_NOTES)
    }

    /** One history entry's exact resolution tag; unresolved is Active. */
    function resolutionTag(entry) {
      if (!entry || entry.resolved !== true) return 'active'
      if (entry.resolution === 'added_to_chat') return 'added_to_chat'
      if (entry.resolution === 'knew_it') return 'knew_it'
      if (entry.resolution === 'thanks') return 'thanks'
      return 'dismissed'
    }

    /** One history entry's human state label; a resolved entry never says Active. */
    function resolutionState(entry) {
      const tag = resolutionTag(entry)
      if (tag === 'added_to_chat') return 'Added to chat'
      if (tag === 'knew_it') return 'Knew it'
      if (tag === 'thanks') return 'Thanks'
      if (tag === 'dismissed') return 'Dismissed'
      return 'Active'
    }

    /** A deterministic UTC timestamp for one note; empty when the value is absent. */
    function formatTimestamp(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      try {
        return new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      } catch (error) {
        return ''
      }
    }

    // The compact inline control shared by the feedback row and Explain states.
    const CARD_BUTTON_STYLE = {
      border: 'none',
      background: 'none',
      color: 'inherit',
      opacity: 0.75,
      cursor: 'pointer',
      fontSize: 12,
      padding: '0 2px',
      whiteSpace: 'nowrap',
    }

    function NoteCard(props) {
      const note = props.note
      const critical = note.importance === 'critical'
      const accent = critical ? 'rgba(239, 68, 68, 0.95)' : 'rgba(245, 158, 11, 0.95)'
      const source = noteSourceOf(note)
      const canOpen = source !== null && typeof props.onOpenFile === 'function'
      return h(
        'section',
        {
          role: 'note',
          'aria-label': 'You should know',
          style: {
            boxSizing: 'border-box',
            width: '100%',
            // The composer caps its card at the same variable, so the note card
            // ends where the composer ends at every window width.
            maxWidth: 'var(--dsh-composer-card-max-width, 952px)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '9px 12px',
            borderRadius: 10,
            border: '1px solid rgba(127, 127, 127, 0.25)',
            borderLeft: `3px solid ${accent}`,
            background: 'rgba(127, 127, 127, 0.08)',
            color: 'inherit',
            fontSize: 13,
            lineHeight: 1.45,
          },
        },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 600,
              color: accent,
              marginBottom: 2,
            },
          }, critical ? 'You should know · critical' : 'You should know'),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, note.note),
          h('div', { style: { display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              onMouseDown: keepComposerFocus,
              onClick: () => props.onKnewIt(),
              title: 'Knew it',
              'aria-label': 'Knew it',
              style: CARD_BUTTON_STYLE,
            }, 'Knew it'),
            h('button', {
              type: 'button',
              onMouseDown: keepComposerFocus,
              onClick: () => props.onThanks(),
              title: 'Thanks',
              'aria-label': 'Thanks',
              style: CARD_BUTTON_STYLE,
            }, 'Thanks'),
            h('button', {
              type: 'button',
              onMouseDown: keepComposerFocus,
              onClick: () => props.onExplain(),
              title: 'Explain',
              'aria-label': props.explainOpen === true ? 'Hide explanation' : 'Explain',
              'aria-expanded': props.explainOpen === true,
              style: CARD_BUTTON_STYLE,
            }, props.explainOpen === true ? 'Hide explanation' : 'Explain')),
          props.explainOpen === true
            ? h('div', {
              role: 'note',
              'aria-label': 'Explanation',
              style: {
                marginTop: 5,
                padding: '5px 8px',
                borderLeft: '2px solid rgba(127, 127, 127, 0.45)',
                background: 'rgba(127, 127, 127, 0.05)',
                fontSize: 12,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            },
              props.explainStatus === 'loading'
                ? 'Loading explanation…'
                : props.explainStatus === 'error'
                  ? h('span', null, 'Could not load an explanation. ', h('button', {
                    type: 'button',
                    onClick: () => props.onRetryExplain(),
                    title: 'Retry explanation',
                    'aria-label': 'Retry explanation',
                    style: CARD_BUTTON_STYLE,
                  }, 'Retry'))
                  : (typeof props.explanation === 'string' ? props.explanation : ''))
            : null,
          source === null ? null : h('div', {
            style: {
              display: 'flex',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 4,
              fontSize: 12,
            },
          },
            // The path is always copyable text. A link appears only when the
            // public file-navigation service is mounted; otherwise there is no
            // fake action, only the exact path the reviewer saw.
            canOpen
              ? h('button', {
                type: 'button',
                onClick: () => props.onOpenFile(source),
                title: 'Open file',
                'aria-label': 'Open file',
                style: {
                  border: 'none',
                  background: 'none',
                  color: 'inherit',
                  opacity: 0.8,
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 12,
                  textDecoration: 'underline',
                },
              }, 'Open file')
              : null,
            h('code', {
              style: { opacity: 0.8, wordBreak: 'break-all', userSelect: 'text' },
            }, sourceLabel(source)))),
        h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
            flex: '0 0 auto',
          },
        },
          h('button', {
            type: 'button',
            onMouseDown: keepComposerFocus,
            onClick: props.onAddToChat,
            title: 'Add to chat',
            'aria-label': 'Add to chat',
            style: {
              border: 'none',
              background: 'none',
              color: 'inherit',
              opacity: 0.7,
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 2px',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            },
          }, 'Add to chat'),
          h('button', {
            type: 'button',
            onClick: props.onDismiss,
            title: 'Dismiss',
            'aria-label': 'Dismiss',
            style: {
              border: 'none',
              background: 'none',
              color: 'inherit',
              opacity: 0.6,
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 2px',
              lineHeight: 1.2,
            },
          }, 'Dismiss')),
      )
    }

    /** One bounded history row: state, finding, timestamp, and optional source. */
    function HistoryEntry(props) {
      const entry = props.entry
      const resolved = entry.resolved === true
      const critical = entry.importance === 'critical'
      const accent = critical ? 'rgba(239, 68, 68, 0.95)' : 'rgba(245, 158, 11, 0.95)'
      const source = noteSourceOf(entry)
      const canOpen = source !== null && typeof props.onOpenFile === 'function'
      const timestamp = formatTimestamp(entry.createdAt)
      return h('section', {
        role: 'history-entry',
        'data-state': resolutionTag(entry),
        style: {
          boxSizing: 'border-box',
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid rgba(127, 127, 127, 0.2)',
          borderLeft: `3px solid ${accent}`,
          background: 'rgba(127, 127, 127, 0.06)',
          color: 'inherit',
          fontSize: 12,
          lineHeight: 1.4,
        },
      },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, fontWeight: 600, color: accent } },
            h('span', null, `State: ${resolutionState(entry)}`),
            h('span', { style: { fontWeight: 400, opacity: 0.8 } }, critical ? 'critical' : 'high'),
            timestamp === '' ? null : h('span', { style: { fontWeight: 400, opacity: 0.8 } }, timestamp)),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, entry.note),
          source === null ? null : h('div', { style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginTop: 3, fontSize: 11 } },
            canOpen
              ? h('button', {
                type: 'button',
                onClick: () => props.onOpenFile(source),
                title: 'Open file',
                'aria-label': 'Open file',
                style: { border: 'none', background: 'none', color: 'inherit', opacity: 0.8, cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline' },
              }, 'Open file')
              : null,
            h('code', { style: { opacity: 0.8, wordBreak: 'break-all', userSelect: 'text' } }, sourceLabel(source))),
          typeof entry.explanation === 'string' && entry.explanation !== ''
            ? h('div', {
              role: 'note',
              'aria-label': 'Explanation',
              style: {
                marginTop: 4,
                padding: '4px 6px',
                borderLeft: '2px solid rgba(127, 127, 127, 0.45)',
                fontSize: 11,
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            }, entry.explanation)
            : null),
        resolved
          ? null
          : h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: '0 0 auto' } },
            h('button', {
              type: 'button',
              onMouseDown: keepComposerFocus,
              onClick: () => props.onAddToChat(entry),
              title: 'Add to chat',
              'aria-label': 'Add to chat',
              style: { border: 'none', background: 'none', color: 'inherit', opacity: 0.75, cursor: 'pointer', fontSize: 11, padding: '0 2px', whiteSpace: 'nowrap' },
            }, 'Add to chat'),
            h('button', {
              type: 'button',
              onClick: () => props.onDismiss(entry),
              title: 'Dismiss',
              'aria-label': 'Dismiss',
              style: { border: 'none', background: 'none', color: 'inherit', opacity: 0.65, cursor: 'pointer', fontSize: 11, padding: '0 2px' },
            }, 'Dismiss')))
    }

    function YouShouldKnowDock(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      // The rendered note set carries the session it was fetched for. Deriving
      // the visible notes from that binding means a session switch stops
      // rendering the old notes in the same render, before the new poll
      // resolves, instead of waiting for the next async update.
      const [view, setView] = useState({ sessionId: '', notes: [], historyCount: 0 })
      const [historyOpen, setHistoryOpen] = useState(false)
      const [historyView, setHistoryView] = useState({ sessionId: '', entries: [] })
      const [historyRevision, setHistoryRevision] = useState(0)
      // Per-note Explain view (open/loading/error/text), bound to the session.
      const [explainView, setExplainView] = useState({ sessionId: '', byNote: {} })
      const notes = view.sessionId === sessionId ? view.notes : []
      const historyCount = view.sessionId === sessionId ? view.historyCount : 0
      const entries = historyView.sessionId === sessionId ? historyView.entries : []
      const explainByNote = explainView.sessionId === sessionId ? explainView.byNote : {}

      useEffect(() => {
        if (sessionId === '') {
          setView({ sessionId: '', notes: [], historyCount: 0 })
          return undefined
        }
        const resolved = resolvedSet(sessionId)
        let cancelled = false
        let timer = null

        const poll = async () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const next = await fetchNotes(sessionId)
          if (cancelled || next === null) return
          setView({
            sessionId,
            notes: next.notes.filter((note) => note && typeof note.id === 'string' && typeof note.note === 'string' && !resolved.has(note.id)),
            historyCount: next.historyCount,
          })
        }

        // Drop any other session's notes synchronously, then start polling.
        setView((current) => (current.sessionId === sessionId ? current : { sessionId, notes: [], historyCount: 0 }))
        poll()
        timer = setInterval(poll, POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') poll()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          cancelled = true
          if (timer !== null) clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [sessionId])

      // History is read only while its panel is open: opening it fetches once,
      // and a resolve bumps the revision for exactly one more read. A stale
      // response is fenced by the cleanup below and by the session binding.
      useEffect(() => {
        if (!historyOpen || sessionId === '') {
          setHistoryView((current) => (current.sessionId === '' && current.entries.length === 0
            ? current
            : { sessionId: '', entries: [] }))
          return undefined
        }
        // React runs this cleanup before any re-run and on unmount, so the
        // cancelled flag alone fences a stale response from an older session.
        let cancelled = false
        const load = async () => {
          const next = await fetchHistory(sessionId)
          if (cancelled || next === null) return
          setHistoryView({ sessionId, entries: next })
        }
        load()
        return () => {
          cancelled = true
        }
      }, [historyOpen, sessionId, historyRevision])

      /** Mark one note locally resolved and drop it from the active stack. */
      function markResolved(noteId) {
        const owner = sessionId
        if (owner === '') return
        resolvedSet(owner).add(noteId)
        setExplainView((current) => {
          if (current.sessionId !== owner || current.byNote[noteId] === undefined) return current
          const byNote = { ...current.byNote }
          delete byNote[noteId]
          return { sessionId: owner, byNote }
        })
        setView((current) => (current.sessionId === owner
          ? {
            sessionId: owner,
            notes: current.notes.filter((item) => item.id !== noteId),
            historyCount: Math.max(current.historyCount, current.notes.length),
          }
          : current))
      }

      function addToChat(note) {
        const owner = sessionId
        // The draft write must succeed before the note is resolved, so a missing
        // or throwing composer face leaves the card exactly as it was.
        if (addNoteToDraft(note, props.inputActions, props.input) !== true) return
        markResolved(note.id)
        resolveOnHost(owner, note.id, 'added_to_chat')
        setHistoryRevision((revision) => revision + 1)
      }

      function dismissNote(note) {
        const owner = sessionId
        markResolved(note.id)
        resolveOnHost(owner, note.id, 'dismissed')
        setHistoryRevision((revision) => revision + 1)
      }

      /** Apply one feedback resolution locally, then best-effort to the host. */
      function resolveFeedback(note, action) {
        const owner = sessionId
        markResolved(note.id)
        resolveOnHost(owner, note.id, action)
        setHistoryRevision((revision) => revision + 1)
      }

      /**
       * Toggle the inline explanation for one note. A cached explanation (from
       * the note payload or a previous call) is shown immediately; otherwise
       * one bounded request runs with loading, error, and retry states that
       * never block the other card actions.
       */
      async function explainNote(note, force) {
        const owner = sessionId
        if (owner === '') return
        const current = explainByNote[note.id] || {}
        const withNote = (entry) => (view) => ({
          sessionId: owner,
          byNote: { ...(view.sessionId === owner ? view.byNote : {}), [note.id]: entry },
        })
        if (current.open === true && force !== true) {
          setExplainView(withNote({ ...current, open: false }))
          return
        }
        const known = typeof note.explanation === 'string' && note.explanation !== ''
          ? note.explanation
          : (typeof current.text === 'string' ? current.text : '')
        if (known !== '' && force !== true) {
          setExplainView(withNote({ open: true, status: 'ok', text: known }))
          return
        }
        setExplainView(withNote({ open: true, status: 'loading', text: '' }))
        const result = await fetchExplain(owner, note.id)
        setExplainView((view) => {
          const base = view.sessionId === owner ? view.byNote : {}
          const entry = base[note.id] || {}
          const next = result !== null && result.ok === true
            ? { ...entry, open: true, status: 'ok', text: result.explanation }
            : { ...entry, open: true, status: 'error', text: '' }
          return { sessionId: owner, byNote: { ...base, [note.id]: next } }
        })
      }

      const visible = orderNoteCards(notes)
      if (sessionId === '') return null
      if (visible.length === 0 && !historyOpen && historyCount === 0) return null

      // The wrapper mirrors the composer's own root: the note column sits inside
      // the same side clearance and caps at the same composer card width, so it
      // tracks the composer at every window width instead of capping at a fixed
      // column. These are the conversation shell's own custom properties,
      // inherited by the dock from the body that owns the composer.
      return h('div', {
        style: {
          boxSizing: 'border-box',
          width: '100%',
          paddingInline: 'var(--dsh-composer-side-clearance, 16px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        },
      },
        h('div', {
          style: {
            boxSizing: 'border-box',
            width: '100%',
            maxWidth: 'var(--dsh-composer-card-max-width, 952px)',
            display: 'flex',
            justifyContent: 'flex-end',
          },
        }, h('button', {
          type: 'button',
          onClick: () => setHistoryOpen((current) => !current),
          'aria-expanded': historyOpen,
          'aria-label': historyOpen ? 'Hide notification history' : 'Show notification history',
          title: 'Notification history',
          style: { border: 'none', background: 'none', color: 'inherit', opacity: 0.65, cursor: 'pointer', fontSize: 11, padding: '0 2px' },
        }, historyOpen ? 'Hide history' : 'History')),
        historyOpen
          ? h('div', {
            role: 'group',
            'aria-label': 'Notification history',
            style: {
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: 'var(--dsh-composer-card-max-width, 952px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            },
          }, entries.length === 0
            ? h('div', { style: { fontSize: 12, opacity: 0.7 } }, 'No notifications yet.')
            : entries.map((entry) => h(HistoryEntry, {
              key: entry.id,
              entry,
              onOpenFile: props.onOpenFile,
              onAddToChat: addToChat,
              onDismiss: dismissNote,
            })))
          : null,
        visible.map((note) => h(NoteCard, {
          key: note.id,
          note,
          onOpenFile: props.onOpenFile,
          onAddToChat: () => {
            // The rendered note set carries its owning session, so a stale card
            // never writes into a newer session's draft. The composer action
            // face and its draft snapshot arrive as standard/owner props; a
            // missing face simply does nothing.
            const owner = view.sessionId
            if (owner !== sessionId) return
            addToChat(note)
          },
          onDismiss: () => {
            // Resolve the session that owns the rendered note set, never a newer
            // session that might have arrived with the props.
            const owner = view.sessionId
            if (owner !== sessionId) return
            dismissNote(note)
          },
          onKnewIt: () => {
            if (view.sessionId !== sessionId) return
            resolveFeedback(note, 'knew_it')
          },
          onThanks: () => {
            if (view.sessionId !== sessionId) return
            resolveFeedback(note, 'thanks')
          },
          onExplain: () => {
            if (view.sessionId !== sessionId) return
            explainNote(note)
          },
          onRetryExplain: () => {
            if (view.sessionId !== sessionId) return
            explainNote(note, true)
          },
          explainOpen: (explainByNote[note.id] || {}).open === true,
          explainStatus: (explainByNote[note.id] || {}).status || 'idle',
          explanation: (() => {
            const local = explainByNote[note.id] || {}
            if (typeof local.text === 'string' && local.text !== '') return local.text
            return typeof note.explanation === 'string' ? note.explanation : ''
          })(),
        })))
    }

    const FIELD_STYLE = { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 2, padding: '4px 6px' }
    const LABEL_STYLE = { display: 'block', fontSize: 12, opacity: 0.8, marginTop: 8 }
    const BUTTON_STYLE = { marginTop: 10, padding: '4px 10px', cursor: 'pointer' }

    /**
     * The Plugins settings card. It is registered under the bundle's key and is
     * entirely host-backed: the form reads the live config and catalog and
     * writes through the same plugin row, so there is no second config store.
     *
     * @param props.actions - the Plugins page face for this bundle.
     */
    function YouShouldKnowSettings(props) {
      const [form, setForm] = useState({ mode: 'automatic', provider: '', model: '', reviewerMode: DEFAULT_REVIEW_MODE, additionalInstructions: '', customReviewerPrompt: '', minDeltaChars: '', cooldownTurns: '', maxContextMessages: '', maxTokens: '', maxReviewerCallsPerHour: '' })
      const [config, setConfig] = useState(null)
      const [catalog, setCatalog] = useState({ providers: [] })
      const [writable, setWritable] = useState(false)
      const [status, setStatus] = useState('')
      const [saving, setSaving] = useState(false)
      const [updateInfo, setUpdateInfo] = useState(null)
      const [updateBusy, setUpdateBusy] = useState(false)
      const [updateMessage, setUpdateMessage] = useState('')
      const [selfCheck, setSelfCheck] = useState(null)
      const [selfCheckBusy, setSelfCheckBusy] = useState(false)
      const [selfCheckError, setSelfCheckError] = useState('')
      const [reconnectCheck, setReconnectCheck] = useState(0)
      const generation = useRef(0)
      const mounted = useRef(true)

      useEffect(() => () => {
        mounted.current = false
      }, [])

      // A connection reset invalidates this surface and refreshes it once.
      useEffect(() => connectionReset.subscribe(() => setReconnectCheck((value) => value + 1)), [])

      useEffect(() => {
        const refresh = async () => {
          const id = generation.current + 1
          generation.current = id
          const payload = await fetchConfig()
          if (!mounted.current || id !== generation.current || payload === null) return
          setConfig(payload.config)
          setCatalog(payload.catalog || { providers: [] })
          setWritable(payload.writable === true)
          setUpdateInfo(payload.update !== null && typeof payload.update === 'object' ? payload.update : null)
          setForm({
            mode: payload.config.mode === 'pinned' ? 'pinned' : 'automatic',
            provider: typeof payload.config.provider === 'string' ? payload.config.provider : '',
            model: typeof payload.config.model === 'string' ? payload.config.model : '',
            reviewerMode: reviewModeOption(payload.config.reviewerMode).id,
            additionalInstructions: typeof payload.config.additionalInstructions === 'string' ? payload.config.additionalInstructions : '',
            customReviewerPrompt: typeof payload.config.customReviewerPrompt === 'string' ? payload.config.customReviewerPrompt : '',
            minDeltaChars: String(payload.config.minDeltaChars),
            cooldownTurns: String(payload.config.cooldownTurns),
            maxContextMessages: String(payload.config.maxContextMessages),
            maxTokens: String(payload.config.maxTokens),
            maxReviewerCallsPerHour: typeof payload.config.maxReviewerCallsPerHour === 'number'
              ? String(payload.config.maxReviewerCallsPerHour)
              : String(DEFAULT_MAX_REVIEWER_CALLS_PER_HOUR),
          })
        }
        refresh()
        const onFocus = () => refresh()
        const onVisibility = () => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', onFocus)
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        return () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', onFocus)
          }
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }
      }, [reconnectCheck])

      const providers = catalogProviders(catalog)
      const models = catalogModels(catalog, form.provider)
      const pinnedValid = form.mode !== 'pinned' || (form.provider !== '' && form.model !== '')
      const disabled = writable !== true

      function update(field, value) {
        setForm((current) => ({ ...current, [field]: value }))
        setStatus('')
      }

      async function save() {
        if (disabled || saving) return
        if (!pinnedValid) {
          setStatus('Choose both a provider and a model for a pinned route.')
          return
        }
        const payload = {
          mode: form.mode,
          reviewerMode: form.reviewerMode,
          additionalInstructions: form.additionalInstructions,
          customReviewerPrompt: form.customReviewerPrompt,
          minDeltaChars: Number(form.minDeltaChars),
          cooldownTurns: Number(form.cooldownTurns),
          maxContextMessages: Number(form.maxContextMessages),
          maxTokens: Number(form.maxTokens),
          maxReviewerCallsPerHour: Number(form.maxReviewerCallsPerHour),
        }
        if (form.mode === 'pinned') {
          payload.provider = form.provider
          payload.model = form.model
        }
        setSaving(true)
        setStatus('Saving…')
        const id = generation.current + 1
        generation.current = id
        const result = await postConfig(payload)
        if (!mounted.current || id !== generation.current) return
        setSaving(false)
        if (result.ok && result.body && result.body.ok === true) {
          setStatus('Saved')
          if (result.body.config) {
            const saved = result.body.config
            setConfig(saved)
            setForm((current) => ({
              ...current,
              mode: saved.mode === 'pinned' ? 'pinned' : 'automatic',
              provider: typeof saved.provider === 'string' ? saved.provider : current.provider,
              model: typeof saved.model === 'string' ? saved.model : current.model,
            }))
          }
          if (result.body.catalog) setCatalog(result.body.catalog)
          return
        }
        const error = result.body && typeof result.body.error === 'string' ? result.body.error : 'request-failed'
        setStatus(`Save failed: ${error}`)
      }

      /**
       * POST one bounded action to the update route. It returns null on any
       * transport or payload failure, so the caller shows honest feedback.
       */
      async function postUpdate(body) {
        try {
          const response = await fetch(UPDATE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
          })
          if (response.ok !== true) return null
          const payload = await response.json()
          return payload !== null && typeof payload === 'object' ? payload : null
        } catch (error) {
          return null
        }
      }

      /**
       * Claim a response generation for an update write. It invalidates any
       * config read already in flight, so an older response cannot overwrite
       * the state this write is about to apply.
       */
      function beginUpdateWrite() {
        const id = generation.current + 1
        generation.current = id
        setUpdateBusy(true)
        return id
      }

      /** Apply one update response only if this component still owns it. */
      function settleUpdateWrite(id) {
        if (mounted.current) setUpdateBusy(false)
        return mounted.current && id === generation.current
      }

      async function applyUpdatePreferences(patch) {
        if (disabled || updateBusy) return
        const id = beginUpdateWrite()
        const payload = await postUpdate({ action: 'set-preferences', ...patch })
        if (!settleUpdateWrite(id)) return
        if (payload !== null && payload.ok === true && payload.update) {
          setUpdateInfo(payload.update)
          setUpdateMessage('Update settings saved.')
          return
        }
        setUpdateMessage('Could not save update settings.')
      }

      async function runUpdateCheck() {
        if (disabled || updateBusy) return
        const id = beginUpdateWrite()
        setUpdateMessage('Checking for updates…')
        const payload = await postUpdate({ action: 'check' })
        if (!settleUpdateWrite(id)) return
        if (payload !== null && payload.update) setUpdateInfo(payload.update)
        if (payload === null || payload.ok !== true) {
          setUpdateMessage('Update check failed.')
          return
        }
        setUpdateMessage(payload.result === 'update-available' ? 'Update available.' : 'You are up to date.')
      }

      async function dismissUpdate(version) {
        if (disabled || updateBusy) return
        const id = beginUpdateWrite()
        const payload = await postUpdate({ action: 'dismiss', version })
        if (!settleUpdateWrite(id)) return
        if (payload !== null && payload.ok === true && payload.update) setUpdateInfo(payload.update)
      }

      /**
       * Run the authenticated in-product self-check on demand. The route is a
       * GET on the connection Fetch carrier, so the host applies the same
       * Host/Origin fence and browser-session authentication as every other
       * plugin route; the browser half handles no token.
       */
      async function runSelfCheck() {
        if (selfCheckBusy) return
        setSelfCheckBusy(true)
        setSelfCheckError('')
        setSelfCheck(null)
        const payload = await fetchSelfCheck()
        if (!mounted.current) return
        setSelfCheckBusy(false)
        if (payload === null) {
          setSelfCheckError('Self-check failed: the authenticated self-check route did not answer.')
          return
        }
        setSelfCheck(payload)
      }

      /**
       * Copy the exact pinned install spec when the page grants a clipboard
       * write. The spec is always visible as selectable text, so this is a
       * convenience and never the only path.
       */
      function copyInstallSpec(spec) {
        try {
          const clipboard = typeof navigator !== 'undefined' && navigator !== null ? navigator.clipboard : undefined
          if (clipboard && typeof clipboard.writeText === 'function') {
            const written = clipboard.writeText(spec)
            // A denied clipboard permission must fall back to the visible text
            // instead of surfacing an unhandled rejection.
            if (written !== null && written !== undefined && typeof written.catch === 'function') {
              written.catch(() => setUpdateMessage('Select and copy the install spec below.'))
            }
            setUpdateMessage('Install spec copied.')
            return
          }
        } catch (error) {
          // Fall through to the always-visible copyable text.
        }
        setUpdateMessage('Select and copy the install spec below.')
      }

      const description = config !== null && config.mode === 'automatic'
        ? AUTOMATIC_DESCRIPTION
        : 'Use a separately configured model for the second-opinion reviewer.'
      const updateView = updateInfo !== null && typeof updateInfo === 'object' ? updateInfo : DEFAULT_UPDATE_STATUS
      const updateBehavior = updateBehaviorOption(updateView.updateBehavior)
      // The discovery source is a build property; the target is only known once
      // a stable tag has been seen. Both are shown as exact, selectable text.
      const updateSource = updateView.source === 'git-tags' ? 'Git tags' : 'unknown'
      const targetSpec = typeof updateView.installSpec === 'string' && updateView.installSpec !== '' ? updateView.installSpec : ''
      const selfCheckRestart = selfCheck !== null ? restartState(selfCheck.runtimeVersion, selfCheck.installedVersion) : 'unavailable'
      const selfCheckHealthy = selfCheck !== null && selfCheck.healthy === true

      return h('section', { style: { padding: '4px 0', display: 'flex', flexDirection: 'column', gap: 2 } },
        h('h3', { style: { margin: 0, fontSize: 14 } }, 'You Should Know'),
        h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, description),
        h('fieldset', { disabled, style: { border: 'none', margin: '10px 0 0', padding: 0 } },
          h('legend', { style: { fontSize: 12, opacity: 0.8, padding: 0 } }, 'Reviewer route'),
          h('label', { style: { display: 'block', fontSize: 12 } },
            h('input', {
              type: 'radio',
              name: 'you-should-know-mode',
              checked: form.mode === 'automatic',
              disabled,
              'aria-label': 'Automatic DeepSeek',
              onChange: (event) => update('mode', checkedValue(event) ? 'automatic' : 'pinned'),
            }),
            ' Automatic DeepSeek'),
          h('label', { style: { display: 'block', fontSize: 12 } },
            h('input', {
              type: 'radio',
              name: 'you-should-know-mode',
              checked: form.mode === 'pinned',
              disabled,
              'aria-label': 'Pinned model',
              onChange: (event) => update('mode', checkedValue(event) ? 'pinned' : 'automatic'),
            }),
            ' Pinned model'),
          form.mode === 'pinned'
            ? h('div', null,
              h('label', { style: LABEL_STYLE }, 'Provider',
                h('select', {
                  style: FIELD_STYLE,
                  value: form.provider,
                  disabled,
                  'aria-label': 'Provider',
                  onChange: (event) => {
                    const value = fieldValue(event)
                    setForm((current) => ({ ...current, provider: value, model: '' }))
                    setStatus('')
                  },
                }, providers.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.id)))),
              h('label', { style: LABEL_STYLE }, 'Model',
                h('select', {
                  style: FIELD_STYLE,
                  value: form.model,
                  disabled,
                  'aria-label': 'Model',
                  onChange: (event) => update('model', fieldValue(event)),
                }, models.map((model) => h('option', { key: model, value: model }, model)))))
            : h('p', { style: { margin: '6px 0 0', fontSize: 12, opacity: 0.8 } }, AUTOMATIC_DESCRIPTION)),
        h('label', { style: LABEL_STYLE }, 'Reviewer mode',
          h('select', {
            style: FIELD_STYLE,
            value: form.reviewerMode,
            disabled,
            'aria-label': 'Reviewer mode',
            onChange: (event) => update('reviewerMode', fieldValue(event)),
          }, REVIEW_MODE_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label)))),
        h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, reviewModeOption(form.reviewerMode).description),
        form.reviewerMode === 'custom'
          ? h('div', null,
            h('label', { style: LABEL_STYLE }, 'Custom reviewer prompt',
              h('textarea', {
                style: { ...FIELD_STYLE, minHeight: 72, resize: 'vertical' },
                value: form.customReviewerPrompt,
                disabled,
                rows: 4,
                'aria-label': 'Custom reviewer prompt',
                onChange: (event) => update('customReviewerPrompt', fieldValue(event)),
              })),
            h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, 'Replaces the strictness profile in Custom mode; the base safety and output rules always apply. A blank prompt uses Balanced.'))
          : null,
        h('label', { style: LABEL_STYLE }, 'Additional reviewer instructions',
          h('textarea', {
            style: { ...FIELD_STYLE, minHeight: 54, resize: 'vertical' },
            value: form.additionalInstructions,
            disabled,
            rows: 3,
            'aria-label': 'Additional reviewer instructions',
            onChange: (event) => update('additionalInstructions', fieldValue(event)),
          })),
        h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, 'Optional. Shapes what the reviewer looks for; the safety and output rules always win.'),
        h('label', { style: LABEL_STYLE }, 'Minimum turn delta',
          h('input', {
            type: 'number',
            style: FIELD_STYLE,
            value: form.minDeltaChars,
            disabled,
            'aria-label': 'Minimum turn delta',
            onChange: (event) => update('minDeltaChars', fieldValue(event)),
          })),
        h('label', { style: LABEL_STYLE }, 'Cooldown turns',
          h('input', {
            type: 'number',
            style: FIELD_STYLE,
            value: form.cooldownTurns,
            disabled,
            'aria-label': 'Cooldown turns',
            onChange: (event) => update('cooldownTurns', fieldValue(event)),
          })),
        h('label', { style: LABEL_STYLE }, 'Context messages',
          h('input', {
            type: 'number',
            style: FIELD_STYLE,
            value: form.maxContextMessages,
            disabled,
            'aria-label': 'Context messages',
            onChange: (event) => update('maxContextMessages', fieldValue(event)),
          })),
        h('label', { style: LABEL_STYLE }, 'Max reviewer tokens',
          h('input', {
            type: 'number',
            style: FIELD_STYLE,
            value: form.maxTokens,
            disabled,
            'aria-label': 'Max reviewer tokens',
            onChange: (event) => update('maxTokens', fieldValue(event)),
          })),
        h('label', { style: LABEL_STYLE }, 'Max reviewer calls per hour',
          h('input', {
            type: 'number',
            style: FIELD_STYLE,
            value: form.maxReviewerCallsPerHour,
            disabled,
            'aria-label': 'Max reviewer calls per hour',
            onChange: (event) => update('maxReviewerCallsPerHour', fieldValue(event)),
          })),
        h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, 'Sliding one-hour cap per session, from 1 to 60. A skipped review makes no model call.'),
        h('button', { type: 'button', style: BUTTON_STYLE, disabled: disabled || saving, onClick: save }, 'Save'),
        status !== '' ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, status) : null,
        disabled ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, 'Host settings are read-only, so this form cannot save.') : null,
        h('fieldset', { disabled, style: { border: 'none', margin: '14px 0 0', padding: 0 } },
          h('legend', { style: { fontSize: 12, opacity: 0.8, padding: 0 } }, 'Updates'),
          h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } },
            `Current version: ${updateView.currentVersion === '' ? 'unknown' : updateView.currentVersion}` +
            (typeof updateView.latestTag === 'string' && updateView.latestTag !== '' ? ` - Latest: ${updateView.latestTag}` : '')),
          h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } },
            `Update source: ${updateSource}` +
            (targetSpec !== '' ? ` - target: ${targetSpec}` : '')),
          h('label', { style: { display: 'block', fontSize: 12, marginTop: 6 } },
            h('input', {
              type: 'checkbox',
              checked: updateView.autoCheckUpdates === true,
              disabled,
              'aria-label': 'Check for updates automatically',
              onChange: (event) => applyUpdatePreferences({ autoCheckUpdates: checkedValue(event) }),
            }),
            ' Check for updates automatically'),
          h('label', { style: LABEL_STYLE }, 'Update behavior',
            h('select', {
              style: FIELD_STYLE,
              value: updateBehavior.id,
              disabled,
              'aria-label': 'Update behavior',
              onChange: (event) => applyUpdatePreferences({ updateBehavior: fieldValue(event) }),
            }, UPDATE_BEHAVIOR_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label)))),
          h('p', { style: { margin: '2px 0 0', fontSize: 12, opacity: 0.8 } }, updateBehavior.description),
          h('button', {
            type: 'button',
            style: BUTTON_STYLE,
            disabled: disabled || updateBusy,
            'aria-label': 'Check for updates',
            onClick: runUpdateCheck,
          }, 'Check for updates'),
          updateMessage !== '' ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, updateMessage) : null,
          updateView.updateAvailable === true && updateView.dismissed !== true
            ? h('div', { style: { marginTop: 8, padding: '8px 10px', border: '1px solid var(--dsh-border, #8884)', borderRadius: 6 } },
              h('p', { style: { margin: 0, fontSize: 12 } },
                `Update available: ${updateView.currentVersion} -> ${updateView.latestTag}`),
              h('code', { style: { display: 'block', margin: '4px 0 0', fontSize: 12, wordBreak: 'break-all' } }, updateView.installSpec),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
                h('button', {
                  type: 'button',
                  disabled,
                  'aria-label': 'Copy install spec',
                  onClick: () => copyInstallSpec(updateView.installSpec),
                }, 'Copy install spec'),
                h('button', {
                  type: 'button',
                  disabled,
                  'aria-label': 'Dismiss update',
                  onClick: () => dismissUpdate(updateView.latestTag),
                }, 'Dismiss')),
              h('p', { style: { margin: '6px 0 0', fontSize: 12, opacity: 0.8 } }, 'This build never installs updates itself. Install the exact pinned spec above through the Plugins settings. Restart DSH Desktop after installing to load the new build.'))
            : null),
        h('fieldset', { style: { border: 'none', margin: '14px 0 0', padding: 0 } },
          h('legend', { style: { fontSize: 12, opacity: 0.8, padding: 0 } }, 'Diagnostics'),
          h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, 'Runs an authenticated in-product check of the live plugin from this page. It reads no conversation text and handles no token.'),
          h('button', {
            type: 'button',
            style: BUTTON_STYLE,
            disabled: selfCheckBusy,
            'aria-label': 'Run self-check',
            onClick: runSelfCheck,
          }, 'Run self-check'),
          selfCheckBusy ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 }, 'data-state': 'checking' }, 'Checking…') : null,
          selfCheckError !== '' ? h('p', { style: { margin: '4px 0 0', fontSize: 12 }, 'data-state': 'failed' }, selfCheckError) : null,
          selfCheck !== null
            ? h('div', { 'data-state': selfCheckHealthy ? 'healthy' : 'unhealthy', style: { marginTop: 6, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 } },
              h('p', { style: { margin: 0 } }, selfCheckHealthy
                ? `Healthy - running plugin ${typeof selfCheck.pluginVersion === 'string' && selfCheck.pluginVersion !== '' ? selfCheck.pluginVersion : 'unknown'}.`
                : `Not healthy - running plugin ${typeof selfCheck.pluginVersion === 'string' && selfCheck.pluginVersion !== '' ? selfCheck.pluginVersion : 'unknown'}. ${selfCheckReason(selfCheck)}`),
              h('p', { style: { margin: 0, opacity: 0.8 } }, `Runtime: ${typeof selfCheck.runtimeStatus === 'string' ? selfCheck.runtimeStatus : 'unknown'}; reviewer mode: ${typeof selfCheck.reviewerMode === 'string' && selfCheck.reviewerMode !== '' ? selfCheck.reviewerMode : 'unknown'}.`),
              h('p', { style: { margin: 0, opacity: 0.8 } }, `Auth transport: ${typeof selfCheck.authTransport === 'string' ? selfCheck.authTransport : 'unknown'}.`),
              h('p', { style: { margin: 0, opacity: 0.8 } }, `Capabilities: ${enabledCapabilities(selfCheck)}.`),
              selfCheckRestart === 'restart-required'
                ? h('p', { style: { margin: 0 }, 'data-state': 'restart-required' }, `Restart required - the installed package is ${selfCheck.installedVersion}, but the running plugin is ${selfCheck.runtimeVersion}. Restart DSH Desktop to load the installed build.`)
                : null,
              selfCheckRestart === 'unavailable'
                ? h('p', { style: { margin: 0, opacity: 0.8 } }, 'The installed or running package version is unavailable, so a restart comparison is not shown.')
                : null)
            : null))
    }

    /**
     * The conversation session header action. It shows the effective reviewer
     * route for this session, pins or resets a session-only override, and can
     * resume a runtime that paused on an exhausted quota. It never reads or
     * writes transcript content and never posts to the primary agent.
     *
     * @param props.sessionId - the session this action belongs to.
     */
    function ReviewerSessionAction(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const [open, setOpen] = useState(false)
      const [session, setSession] = useState(null)
      const [detail, setDetail] = useState({ providers: [], configured: false })
      const [selection, setSelection] = useState({ routeKey: '', provider: '', model: '' })
      const [status, setStatus] = useState('')
      const [reconnectCheck, setReconnectCheck] = useState(0)
      const generation = useRef(0)
      const mounted = useRef(true)

      useEffect(() => () => {
        mounted.current = false
      }, [])

      // A connection reset invalidates this surface and refreshes it once.
      useEffect(() => connectionReset.subscribe(() => setReconnectCheck((value) => value + 1)), [])

      useEffect(() => {
        if (!open || sessionId === '') {
          setSession(null)
          return undefined
        }
        const refresh = async () => {
          const id = generation.current + 1
          generation.current = id
          const next = await fetchSession(sessionId)
          const live = await fetchConfig()
          if (!mounted.current || id !== generation.current || next === null || next.sessionId !== sessionId) return
          setSession(next)
          setDetail({
            providers: catalogProviders(live && live.catalog),
            /** The host reads the effective route from the live engine, so the
             *  action does not need a second session-specific config read. */
            configured: true,
          })
        }
        refresh()
        const onFocus = () => refresh()
        const onVisibility = () => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') refresh()
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('focus', onFocus)
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        return () => {
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', onFocus)
          }
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }
      }, [open, sessionId, reconnectCheck])

      const effective = session && session.effectiveRoute ? session.effectiveRoute : null
      const routeKey = effective ? `${effective.provider}/${effective.model}` : ''
      if (selection.routeKey !== routeKey) {
        setSelection({
          routeKey,
          provider: effective ? effective.provider : '',
          model: effective ? effective.model : '',
        })
      }

      const providerIds = detail.providers.map((entry) => entry.id)
      if (effective && effective.provider !== '' && !providerIds.includes(effective.provider)) {
        providerIds.unshift(effective.provider)
      }
      // A fresh copy: the catalog helper may return the state array itself.
      const modelIds = [...catalogModels({ providers: detail.providers }, selection.provider)]
      if (effective && effective.provider === selection.provider && !modelIds.includes(effective.model)) {
        modelIds.unshift(effective.model)
      }
      const runtime = session && session.session ? session.session.runtimeStatus : undefined
      const pending = session && session.session && Number.isInteger(session.session.noteCount) ? session.session.noteCount : 0
      const quota = runtime === 'quota_exhausted'
      // The select is controlled by the session's own override: an absent
      // override is the "Default" option, which clears it on change.
      const modeOverride = session && typeof session.sessionModeOverride === 'string' ? session.sessionModeOverride : ''
      const effectiveModeLabel = reviewModeOption(
        session && typeof session.effectiveMode === 'string' ? session.effectiveMode : DEFAULT_REVIEW_MODE,
      ).label

      async function act(body) {
        const result = await postSession(body)
        if (!mounted.current) return
        if (result === null) {
          setStatus('Request failed')
          return
        }
        const next = await fetchSession(sessionId)
        if (!mounted.current) return
        if (next !== null && next.sessionId === sessionId) setSession(next)
        setStatus(body.action === 'resume' ? 'Resuming reviewer' : 'Saved')
      }

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('button', {
          type: 'button',
          onClick: () => setOpen((current) => !current),
          title: 'Reviewer route for this session',
        }, 'Reviewer'),
        open
          ? h('div', { role: 'group', 'aria-label': 'Reviewer session route', style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 } },
            session === null
              ? h('span', null, 'Loading…')
              : h('div', null,
                h('div', null, `Effective: ${routeSummary(effective)} · ${sourceLabel(session.effectiveRouteSource)}`),
                h('div', null, `Mode: ${effectiveModeLabel} · ${session.effectiveModeSource === 'session' ? 'This session' : 'Global'}`),
                h('div', null, `Status: ${runtime === undefined ? 'idle' : runtime}`),
                h('div', null, `Pending notes: ${pending}`),
                h('label', null, 'Provider',
                  h('select', {
                    value: selection.provider,
                    'aria-label': 'Session provider',
                    onChange: (event) => {
                      const value = fieldValue(event)
                      setSelection((current) => ({ ...current, routeKey, provider: value, model: '' }))
                    },
                  }, providerIds.map((id) => h('option', { key: id, value: id }, id)))),
                h('label', null, 'Model',
                  h('select', {
                    value: selection.model,
                    'aria-label': 'Session model',
                    onChange: (event) => setSelection((current) => ({ ...current, routeKey, model: fieldValue(event) })),
                  }, modelIds.map((model) => h('option', { key: model, value: model }, model)))),
                h('label', null, 'Mode',
                  h('select', {
                    value: modeOverride,
                    'aria-label': 'Session reviewer mode',
                    onChange: (event) => {
                      const value = fieldValue(event)
                      act(value === '' ? { action: 'reset-mode', sessionId } : { action: 'set-mode', sessionId, mode: value })
                    },
                  }, [
                    h('option', { key: 'default', value: '' }, 'Default'),
                    ...REVIEW_MODE_OPTIONS.map((option) => h('option', { key: option.id, value: option.id }, option.label)),
                  ])),
                effectiveModeLabel === 'Custom'
                  ? h('span', null, 'Custom uses the global custom reviewer prompt.')
                  : null,
                h('button', {
                  type: 'button',
                  onClick: () => act({ action: 'set-model', sessionId, provider: selection.provider, model: selection.model }),
                }, 'Pin for this session'),
                h('button', {
                  type: 'button',
                  onClick: () => act({ action: 'reset-model', sessionId }),
                }, 'Use global default')),
            quota
              ? h('button', { type: 'button', onClick: () => act({ action: 'resume', sessionId }) }, 'Resume reviewer')
              : null,
            status !== '' ? h('span', null, status) : null)
          : null)
    }

    return {
      name: 'dsh-you-should-know',
      // The connection service carries the reconnect signal every host-backed
      // surface refreshes on, so the host injects it alongside slots.
      inject: ['slots', 'connection'],
      apply(ctx) {
        if (ctx.connection && typeof ctx.connection.on === 'function') {
          ctx.connection.on('connection/reset', () => connectionReset.toggle())
        }
        // The dock's owner props are { session, input }; the framework calls this
        // inject face with the scope binding's key, which is the session id.
        // The right-Sidebar face is the public file-navigation seam
        // (openResource). It is resolved when the dock injects, so a later
        // mount is not cached away; when it is absent the card renders the
        // source as copyable text instead of a dead link.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'you-should-know',
          order: 15,
          inject: (sessionId) => {
            const id = typeof sessionId === 'string' ? sessionId : ''
            const sidebar = typeof ctx.get === 'function' ? ctx.get('sidebarRight') : ctx.sidebarRight
            const onOpenFile = sidebar && typeof sidebar.openResource === 'function'
              ? (source) => {
                try {
                  const address = sessionFileAddress(id, source.path)
                  if (address === null) return
                  if (source.line === undefined) sidebar.openResource(address)
                  else sidebar.openResource(address, { params: { line: source.line } })
                } catch (error) {
                  // Fail quiet: navigation must never disturb the card or page.
                }
              }
              : undefined
            return { sessionId: id, onOpenFile }
          },
        }, YouShouldKnowDock))

        // The Plugins settings card for this bundle. Its config is entirely
        // host-backed, so the actions face carries the connection service used
        // to refresh when the browser reconnects.
        ctx.slots.inject('plugins.bundle.config', function* () {
          yield ctx.slots.register({
            name: 'plugins.bundle.config',
            key: 'dsh-you-should-know',
            inject: () => ({}),
          }, YouShouldKnowSettings)
        })

        // The compact reviewer action in the conversation session header. The
        // owner props are session-scoped, so the inject face receives the
        // scope binding's key, which is the session id.
        ctx.slots.inject('conversation.session.header.actions', function* () {
          yield ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'dsh-you-should-know',
            inject: (sessionId) => ({ sessionId: typeof sessionId === 'string' ? sessionId : '' }),
          }, ReviewerSessionAction)
        })
      },
    }
  },
})
