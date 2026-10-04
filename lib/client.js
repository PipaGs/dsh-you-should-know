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
    const NOTES_URL = '/dsh-you-should-know/notes'
    const DISMISS_URL = '/dsh-you-should-know/dismiss'

    // Page-lifetime, per-session dismissal memory: the host keeps serving a
    // note until it is dismissed, and this set stops it reappearing on the
    // next poll.
    const dismissedBySession = new Map()

    function dismissedSet(sessionId) {
      let set = dismissedBySession.get(sessionId)
      if (set === undefined) {
        set = new Set()
        dismissedBySession.set(sessionId, set)
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
      const [notes, setNotes] = useState([])

      useEffect(() => {
        if (sessionId === '') {
          setNotes([])
          return undefined
        }
        const dismissed = dismissedSet(sessionId)
        let cancelled = false
        let timer = null

        const poll = async () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          const next = await fetchNotes(sessionId)
          if (cancelled || next === null) return
          setNotes(next.filter((note) => note && typeof note.id === 'string' && typeof note.note === 'string' && !dismissed.has(note.id)))
        }

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
            dismissedSet(sessionId).add(note.id)
            setNotes((current) => current.filter((item) => item.id !== note.id))
            dismissOnHost(sessionId, note.id)
          },
        })))
    }

    return {
      name: 'dsh-you-should-know',
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'you-should-know',
          order: 15,
        }, YouShouldKnowDock))
      },
    }
  },
})
