import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, normalizeConfig } from '../lib/core.js'

const NOW = 1700000000000

function normalizedConfig(overrides = {}) {
  return normalizeConfig({
    provider: 'p',
    model: 'm',
    minDeltaChars: 0,
    cooldownTurns: 1,
    maxReviewerCallsPerHour: 60,
    ...overrides,
  }).config
}

function fakeLlm(script = []) {
  const calls = []
  const llm = {
    calls,
    resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
    stream(options) {
      calls.push(options)
      const text = script.length > 0 ? script.shift() : '{"note":null,"importance":null}'
      return (async function* stream() {
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
  return llm
}

function engineWith(script = [], overrides = {}) {
  const llm = fakeLlm(script)
  const errors = []
  const engine = createEngine({
    config: normalizedConfig(overrides),
    getLlm: () => llm,
    now: () => NOW,
    onError: (error) => errors.push(error),
  })
  return { engine, llm, errors }
}

function turnEnd(seq, turn) {
  return { type: 'turn/end', seq, data: { turn, reason: { kind: 'completed' } } }
}

function userEvent(seq, text) {
  return {
    type: 'user/message',
    seq,
    data: { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

function assistantEvent(seq, turn, text) {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn,
      step: 0,
      message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
      stream: [],
    },
  }
}

function sessionWith(id, turns) {
  const events = []
  let seq = 1
  for (const turn of turns) {
    events.push(userEvent(seq += 1, `question ${turn.turn}`))
    events.push(assistantEvent(seq += 1, turn.turn, turn.answer))
    events.push(turnEnd(seq += 1, turn.turn))
  }
  return { id, header: { id }, events, lastEvent: events[events.length - 1] }
}

function appendTurn(session, turn, answer) {
  const next = session.events[session.events.length - 1].seq + 1
  session.events.push(userEvent(next, `question ${turn}`), assistantEvent(next + 1, turn, answer), turnEnd(next + 2, turn))
  session.lastEvent = session.events[session.events.length - 1]
}

async function observeTurn(engine, session) {
  const outcome = engine.observe(session, session.lastEvent)
  if (outcome.promise) return await outcome.promise
  return outcome
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

test('recent-check diagnostics are off by default and records keep the minimal shape', async () => {
  const off = engineWith(['{"note":"A finding.","importance":"high"}'])
  const offSession = sessionWith('s-default', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeTurn(off.engine, offSession)).status, 'noted')
  assert.equal(off.engine.config().recentCheckDiagnostics, false)
  assert.equal('recentChecks' in off.engine.status('s-default').session, false, 'the opt-in is off by default')

  const on = engineWith(['{"note":"A finding.","importance":"high"}'], { recentCheckDiagnostics: true })
  const onSession = sessionWith('s-shape', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeTurn(on.engine, onSession)).status, 'noted')
  const records = on.engine.status('s-shape').session.recentChecks
  assert.deepEqual(records, [{ at: NOW, turn: 1, outcome: 'noted' }])
  assert.deepEqual(Object.keys(records[0]).sort(), ['at', 'outcome', 'turn'], 'a record carries exactly at, outcome, and turn')
})

test('disabling the reviewer hides and clears recent checks and re-enabling starts empty', async () => {
  const { engine } = engineWith(['{"note":null,"importance":null}'], { recentCheckDiagnostics: true })
  const first = sessionWith('s-disable-a', [{ turn: 1, answer: 'one' }])
  const second = sessionWith('s-disable-b', [{ turn: 1, answer: 'two' }])
  assert.equal((await observeTurn(engine, first)).status, 'silent')
  assert.equal((await observeTurn(engine, second)).status, 'silent')
  assert.equal(engine.status('s-disable-a').session.recentChecks.length, 1)
  assert.equal(engine.status('s-disable-b').session.recentChecks.length, 1)

  engine.updateConfig({ ...engine.config(), provider: '', model: '' })
  assert.equal(engine.config().disabled, true)
  for (const id of ['s-disable-a', 's-disable-b']) {
    const snapshot = engine.status(id).session
    assert.equal('recentChecks' in snapshot, false, 'a disabled reviewer never emits the field')
    assert.equal(snapshot.runtimeStatus, 'disposed')
  }

  engine.updateConfig({ ...engine.config(), provider: '', model: '' })
  assert.equal('recentChecks' in engine.status('s-disable-a').session, false, 'a repeated disable stays hidden')

  engine.updateConfig({ ...engine.config(), provider: 'p', model: 'm' })
  assert.deepEqual(engine.status('s-disable-a').session.recentChecks, [], 're-enabling starts empty')
  assert.deepEqual(engine.status('s-disable-b').session.recentChecks, [])
})

test('a review that settles after disabling adds no recent-check record', async () => {
  const engine = createEngine({
    config: normalizedConfig({ recentCheckDiagnostics: true }),
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        return (async function* stream() {
          await new Promise(() => {})
          yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
        })()
      },
    }),
    now: () => NOW,
    onError: () => {},
  })
  const session = sessionWith('s-in-flight-disable', [{ turn: 1, answer: 'one' }])
  const reviewing = engine.observe(session, session.lastEvent)
  assert.equal(reviewing.status, 'reviewing')
  await settle()

  engine.updateConfig({ ...engine.config(), provider: '', model: '' })
  assert.equal((await reviewing.promise).status, 'aborted', 'disabling aborts the in-flight review')
  assert.equal('recentChecks' in engine.status('s-in-flight-disable').session, false)

  engine.updateConfig({ ...engine.config(), provider: 'p', model: 'm' })
  assert.deepEqual(
    engine.status('s-in-flight-disable').session.recentChecks,
    [],
    'an aborted review settling after the disable leaves the re-enabled history empty',
  )
})

test('a review aborted by a disable and settled after a quick re-enable adds no recent-check record', async () => {
  let calls = 0
  const engine = createEngine({
    config: normalizedConfig({ recentCheckDiagnostics: true }),
    getLlm: () => ({
      resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model }),
      stream() {
        calls += 1
        const hang = calls === 1
        return (async function* stream() {
          if (hang) await new Promise(() => {})
          yield { type: 'text-delta', index: 0, text: '{"note":null,"importance":null}' }
        })()
      },
    }),
    now: () => NOW,
    onError: () => {},
  })
  const session = sessionWith('s-rapid-toggle', [{ turn: 1, answer: 'one' }])
  const reviewing = engine.observe(session, session.lastEvent)
  assert.equal(reviewing.status, 'reviewing')
  await settle()

  engine.updateConfig({ ...engine.config(), provider: '', model: '' })
  // Re-enable before the aborted review settles: the settle must still belong to
  // the disabled epoch and must not refill the history the disable cleared.
  engine.updateConfig({ ...engine.config(), provider: 'p', model: 'm' })
  assert.equal((await reviewing.promise).status, 'aborted', 'disabling aborts the in-flight review')
  assert.deepEqual(
    engine.status('s-rapid-toggle').session.recentChecks,
    [],
    'an aborted review settling after the re-enable adds no record',
  )

  appendTurn(session, 2, 'two')
  assert.equal((await observeTurn(engine, session)).status, 'silent')
  assert.deepEqual(
    engine.status('s-rapid-toggle').session.recentChecks,
    [{ at: NOW, turn: 2, outcome: 'silent' }],
    'a review started after the re-enable records normally',
  )
})

test('disabling the reviewer preserves notes, dedupe, and known fingerprints', async () => {
  const { engine } = engineWith([
    '{"note":"First finding.","importance":"high"}',
    '{"note":"Second finding.","importance":"high"}',
    '{"note":"First finding.","importance":"high"}',
    '{"note":"Second finding.","importance":"high"}',
  ], { recentCheckDiagnostics: true })
  const session = sessionWith('s-preserve', [{ turn: 1, answer: 'one' }])
  assert.equal((await observeTurn(engine, session)).status, 'noted')
  appendTurn(session, 2, 'two')
  assert.equal((await observeTurn(engine, session)).status, 'noted')

  const notes = engine.notes('s-preserve')
  assert.equal(notes.length, 2)
  const secondNote = engine.history('s-preserve').find((note) => note.note === 'Second finding.')
  assert.equal(engine.resolve('s-preserve', secondNote.id, 'knew_it'), true, 'the known fingerprint is recorded')
  assert.equal(engine.historyCount('s-preserve'), 2)
  assert.equal(engine.status('s-preserve').session.knownFingerprintCount, 1)
  assert.equal(engine.status('s-preserve').session.recentChecks.length, 2)

  engine.updateConfig({ ...engine.config(), provider: '', model: '' })
  const disabled = engine.status('s-preserve').session
  assert.equal('recentChecks' in disabled, false, 'a disabled reviewer hides the field')
  assert.equal(disabled.historyCount, 2, 'notes survive a disable')
  assert.equal(disabled.knownFingerprintCount, 1, 'known fingerprints survive a disable')

  engine.updateConfig({ ...engine.config(), provider: 'p', model: 'm' })
  assert.deepEqual(engine.status('s-preserve').session.recentChecks, [], 're-enabling starts empty')

  appendTurn(session, 3, 'three')
  assert.equal((await observeTurn(engine, session)).status, 'duplicate', 'dedupe survives the disable')
  // The duplicate is a quiet outcome, so the adaptive cooldown skips one turn.
  appendTurn(session, 4, 'four')
  assert.equal(engine.observe(session, session.lastEvent).status, 'cooldown')
  appendTurn(session, 5, 'five')
  assert.equal((await observeTurn(engine, session)).status, 'suppressed', 'known fingerprints survive the disable')
  assert.equal(engine.historyCount('s-preserve'), 2, 'a duplicate and a suppression add no note')

  const records = engine.status('s-preserve').session.recentChecks
  assert.deepEqual(records.map((record) => record.outcome), ['suppressed', 'duplicate'])
  assert.deepEqual(records.map((record) => record.turn), [5, 3])
  for (const record of records) {
    assert.deepEqual(Object.keys(record).sort(), ['at', 'outcome', 'turn'])
    assert.equal(record.at, NOW)
  }
})