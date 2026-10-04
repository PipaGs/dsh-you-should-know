// Browser half of dsh-you-should-know.
//
// Registered as a lazy CommonJS factory in the Web client's module table. It
// renders a compact "You should know" card above the composer and polls the
// host route while the page is visible. It returns null when there is no note,
// and it never writes to the conversation transcript.

window.__ModuleLoader__.load({
  id: 'dsh-you-should-know',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const POLL_MS = 7000
    // The Desktop loads the app from the dsh-app://app/ origin and proxies
    // /api to the host. Document-relative URLs resolve against that origin
    // (dsh-app://app/api/...); an origin-root absolute path would not.
    const NOTES_URL = 'api/dsh-you-should-know/notes'
    const DISMISS_URL = 'api/dsh-you-should-know/dismiss'
    // Matches the host's maxTrackedSessions so the page-lifetime memory cannot
    // outgrow the host table it mirrors.
    const MAX_DISMISSED_SESSIONS = 200

    // Page-lifetime, per-session dismissal memory: the host keeps serving a
    // note until it is dismissed, and this set stops it reappearing on the
    // next poll. The table is bounded: the oldest session is evicted when a
    // new one would exceed the cap, which preserves recent-session behavior
    // without growing for the life of the page.
    const dismissedBySession = new Map()

    function dismissedSet(sessionId) {
      let set = dismissedBySession.get(sessionId)
      if (set === undefined) {
        set = new Set()
        dismissedBySession.set(sessionId, set)
        if (dismissedBySession.size > MAX_DISMISSED_SESSIONS) {
          dismissedBySession.delete(dismissedBySession.keys().next().value)
        }
      }
      return set
    }

    async function fetchNotes(sessionId) {
      try {
        const response = await fetch(`${NOTES_URL}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
        if (response.ok !== true) return null
        const payload = await response.json()
        if (!payload || payload.ok !== true || !Array.isArray(payload.notes)) return null
        return payload.notes
      } catch (error) {
        return null
      }
    }

    function dismissOnHost(sessionId, noteId) {
      try {
        fetch(DISMISS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, noteId }),
          cache: 'no-store',
          keepalive: true,
        }).catch(() => {})
      } catch (error) {
        // Best effort: the local dismissal above already hid the note.
      }
    }

    function NoteCard(props) {
      const note = props.note
      const critical = note.importance === 'critical'
      const accent = critical ? 'rgba(239, 68, 68, 0.95)' : 'rgba(245, 158, 11, 0.95)'
      return h(
        'section',
        {
          role: 'note',
          'aria-label': 'You should know',
          style: {
            boxSizing: 'border-box',
            width: '100%',
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
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, note.note)),
        h('button', {
          type: 'button',
          onClick: props.onDismiss,
          title: 'Dismiss',
          'aria-label': 'Dismiss',
          style: {
            flex: '0 0 auto',
            border: 'none',
            background: 'none',
            color: 'inherit',
            opacity: 0.6,
            cursor: 'pointer',
            fontSize: 12,
            padding: '0 2px',
            lineHeight: 1.2,
          },
        }, 'Dismiss'),
      )
    }

    function YouShouldKnowDock(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      // The rendered note set carries the session it was fetched for. Deriving
      // the visible notes from that binding means a session switch stops
      // rendering the old notes in the same render, before the new poll
      // resolves, instead of waiting for the next async update.
      const [view, setView] = useState({ sessionId: '', notes: [] })
      const notes = view.sessionId === sessionId ? view.notes : []

      useEffect(() => {
        if (sessionId === '') {
          setView({ sessionId: '', notes: [] })
          return undefined
        }
        const dismissed = dismissedSet(sessionId)
        let cancelled = false
        let timer = null

        const poll = async () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const next = await fetchNotes(sessionId)
          if (cancelled || next === null) return
          setView({
            sessionId,
            notes: next.filter((note) => note && typeof note.id === 'string' && typeof note.note === 'string' && !dismissed.has(note.id)),
          })
        }

        // Drop any other session's notes synchronously, then start polling.
        setView((current) => (current.sessionId === sessionId ? current : { sessionId, notes: [] }))
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

      if (notes.length === 0) return null

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' } },
        notes.map((note) => h(NoteCard, {
          key: note.id,
          note,
          onDismiss: () => {
            // Dismiss the session that owns the rendered note set, never a
            // newer session that might have arrived with the props.
            const owner = view.sessionId
            if (owner !== sessionId) return
            dismissedSet(owner).add(note.id)
            setView((current) => (current.sessionId === owner
              ? { sessionId: owner, notes: current.notes.filter((item) => item.id !== note.id) }
              : current))
            dismissOnHost(owner, note.id)
          },
        })))
    }

    return {
      name: 'dsh-you-should-know',
      inject: ['slots'],
      apply(ctx) {
        // The dock's owner props are { session, input }; the framework calls this
        // inject face with the scope binding's key, which is the session id.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'you-should-know',
          order: 15,
          inject: (sessionId) => ({ sessionId: typeof sessionId === 'string' ? sessionId : '' }),
        }, YouShouldKnowDock))
      },
    }
  },
})
