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
    const DISMISS_URL = 'api/dsh-you-should-know/dismiss'
    const CONFIG_URL = 'api/dsh-you-should-know/config'
    const SESSION_URL = 'api/dsh-you-should-know/session'
    // Matches the host's maxTrackedSessions so the page-lifetime memory cannot
    // outgrow the host table it mirrors.
    const MAX_DISMISSED_SESSIONS = 200

    const AUTOMATIC_DESCRIPTION = 'Picks the cheapest registered DeepSeek route when a turn qualifies; stays quiet when this build mounts none.'

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

      // The outer card owns the shared composer-adjacent column: it responds to
      // the dock width but caps at the 752px context-card column and centers,
      // so it never stretches edge to edge across the whole dock.
      return h('div', {
        style: {
          boxSizing: 'border-box',
          width: 'calc(100% - 88px)',
          maxWidth: 752,
          marginInline: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        },
      },
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
      const [form, setForm] = useState({ mode: 'automatic', provider: '', model: '', minDeltaChars: '', cooldownTurns: '', maxContextMessages: '', maxTokens: '' })
      const [config, setConfig] = useState(null)
      const [catalog, setCatalog] = useState({ providers: [] })
      const [writable, setWritable] = useState(false)
      const [status, setStatus] = useState('')
      const [saving, setSaving] = useState(false)
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
          setForm({
            mode: payload.config.mode === 'pinned' ? 'pinned' : 'automatic',
            provider: typeof payload.config.provider === 'string' ? payload.config.provider : '',
            model: typeof payload.config.model === 'string' ? payload.config.model : '',
            minDeltaChars: String(payload.config.minDeltaChars),
            cooldownTurns: String(payload.config.cooldownTurns),
            maxContextMessages: String(payload.config.maxContextMessages),
            maxTokens: String(payload.config.maxTokens),
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
          minDeltaChars: Number(form.minDeltaChars),
          cooldownTurns: Number(form.cooldownTurns),
          maxContextMessages: Number(form.maxContextMessages),
          maxTokens: Number(form.maxTokens),
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

      const description = config !== null && config.mode === 'automatic'
        ? AUTOMATIC_DESCRIPTION
        : 'Use a separately configured model for the second-opinion reviewer.'

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
        h('button', { type: 'button', style: BUTTON_STYLE, disabled: disabled || saving, onClick: save }, 'Save'),
        status !== '' ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, status) : null,
        disabled ? h('p', { style: { margin: '4px 0 0', fontSize: 12, opacity: 0.8 } }, 'Host settings are read-only, so this form cannot save.') : null)
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
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'you-should-know',
          order: 15,
          inject: (sessionId) => ({ sessionId: typeof sessionId === 'string' ? sessionId : '' }),
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
