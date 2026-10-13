#!/usr/bin/env node
/*
 * Visual capture for the hidden empty state of the dsh-you-should-know composer dock.
 *
 *   node capture.cjs <url-with-token> <output-dir>
 *
 * Environment:
 *   PLAYWRIGHT_MODULE        module id or path of the playwright package
 *   PLAYWRIGHT_BROWSERS_PATH browsers root (default: <home>/Library/Caches/ms-playwright)
 *   CHROMIUM_PATH            explicit chrome-headless-shell executable
 *   TASK_ID, PRODUCT_COMMIT, BASE_COMMIT, LIB_CLIENT_SHA, CAPTURED_BY,
 *   HOST_APP, HOST_VERSION, DSH_INVOCATION  optional provenance metadata
 *
 * Fidelity:
 *   - The EMPTY state is captured with NO request interception, so it renders
 *     from the real authenticated host route GET api/dsh-you-should-know/notes.
 *     The observed response is written to empty-host-response.json.
 *   - Only AFTER the empty capture does the script install fixtures at the
 *     browser HTTP boundary for populated / history / empty-again states, so
 *     the reverse transition is proven on the same page without a reload.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit !== undefined && explicit !== '') return require(explicit);
  return require('playwright');
}

function findExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(root)) return undefined;
  const names = fs.readdirSync(root).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const name of names) {
    for (const triple of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-win64']) {
      const candidate = path.join(root, name, triple, 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const URL_ARG = process.argv[2];
const OUT = process.argv[3];
const NOW = Date.now();

const NOTE = {
  id: 'viz-note-1',
  note: 'The retry loop never clears its timer, so a disposed session keeps polling after the host restarted.',
  importance: 'critical',
  createdAt: NOW - 60000,
  action: 'Clear the polling timer in the session teardown and add a regression test for the disposed session.',
  source: { path: 'lib/runtime.js', line: 42 },
};
const HISTORY = [
  { id: 'viz-note-1', note: NOTE.note, importance: 'critical', createdAt: NOW - 60000, resolved: false, source: { path: 'lib/runtime.js', line: 42 } },
  { id: 'viz-hist-1', note: 'A dismissed finding kept its resolved state and its source line.', importance: 'high', createdAt: NOW - 120000, resolved: true, resolution: 'dismissed', resolvedAt: NOW - 90000, source: { path: 'lib/core.js', line: 7 } },
];

let mode = 'empty';
const realNotes = [];

async function dismissModal(page) {
  for (const label of ['Configure later', 'Continue']) {
    const button = page.getByRole('button', { name: label });
    if (await button.count() > 0) {
      try { await button.first().click({ timeout: 4000 }); } catch (error) { /* overlay may be gone */ }
      await sleep(400);
    }
  }
  await sleep(200);
}

async function dockMetrics(page) {
  return await page.evaluate(() => {
    const slot = document.querySelector('[data-slot="conversation.input.dock"]');
    const stack = document.querySelector('.ST7X_W_composerStack');
    const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
    const unionRect = (nodes) => {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9, found = false;
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        found = true;
        x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
      }
      return found ? { x: Math.round(x1), y: Math.round(y1), width: Math.round(x2 - x1), height: Math.round(y2 - y1) } : null;
    };
    const buttonText = (label) => Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === label);
    return {
      dockSlot: rect(slot),
      dockContent: unionRect(slot ? Array.from(slot.children) : []),
      dockSlotChildren: slot ? slot.children.length : null,
      dockSlotHtml: slot ? slot.innerHTML : null,
      composerStack: rect(stack),
      youShouldKnowNodes: document.querySelectorAll('[aria-label="You should know"]').length,
      noteCards: document.querySelectorAll('[role="note"]').length,
      emptyStateNodes: document.querySelectorAll('[data-state="empty"]').length,
      hasNoNotesYet: document.body.innerText.includes('No notes yet'),
      actions: { addToChat: buttonText('Add to chat'), dismiss: buttonText('Dismiss'), knewIt: buttonText('Knew it'), thanks: buttonText('Thanks'), explain: buttonText('Explain') },
      bodyText: document.body.innerText,
    };
  });
}

async function capture(page, name) {
  const metrics = await dockMetrics(page);
  const stack = metrics.composerStack;
  if (stack !== null && stack.width > 0 && stack.height > 0) {
    await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: Math.max(0, stack.x - 16), y: Math.max(0, stack.y - 16), width: Math.min(stack.width + 32, 1280), height: Math.min(stack.height + 32, 900) } });
  }
  await page.screenshot({ path: path.join(OUT, name + '-page.png') });
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(path.join(OUT, name + '.txt'), metrics.bodyText);
  console.log('captured ' + name + ' dockSlot=' + JSON.stringify(metrics.dockSlot) + ' children=' + metrics.dockSlotChildren + ' youShouldKnow=' + metrics.youShouldKnowNodes + ' noteCards=' + metrics.noteCards + ' noNotesYet=' + metrics.hasNoNotesYet);
  return metrics;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const executablePath = findExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  page.on('response', async (response) => {
    if (!response.url().includes('/api/dsh-you-should-know/notes')) return;
    let body = null;
    let error = null;
    try { body = await response.json(); } catch (caught) { error = String(caught && caught.message); }
    realNotes.push({ status: response.status(), body: body, error: error });
  });

  await page.goto(URL_ARG, { waitUntil: 'networkidle' });
  await sleep(1500);
  await dismissModal(page);
  const chooser = page.locator('[aria-label="Choose workspace"]');
  if (await chooser.count() > 0 && (await chooser.first().innerText()).trim() === 'Choose workspace') {
    await chooser.first().click();
    await sleep(600);
    const items = page.locator('[role="menuitem"]').filter({ hasNotText: 'Add workspace' });
    if (await items.count() > 0) { await items.first().click(); await sleep(2500); }
  }
  await dismissModal(page);

  const deadline = Date.now() + 25000;
  while (realNotes.length === 0 && Date.now() < deadline) await sleep(250);
  await sleep(1500);
  if (realNotes.length === 0) throw new Error('the real host notes route was never observed before the empty capture');
  const first = realNotes[0];
  const summary = {
    observedResponses: realNotes.length,
    status: first.status,
    ok: first.body !== null && first.body.ok === true,
    notesIsArray: first.body !== null && Array.isArray(first.body.notes),
    noteCount: first.body !== null && Array.isArray(first.body.notes) ? first.body.notes.length : null,
    historyCount: first.body !== null && Number.isInteger(first.body.historyCount) ? first.body.historyCount : null,
    parseError: first.error,
    source: 'real host route, no interception',
  };
  fs.writeFileSync(path.join(OUT, 'empty-host-response.json'), JSON.stringify(summary, null, 2));
  if (summary.status !== 200 || summary.ok !== true || summary.notesIsArray !== true || summary.noteCount !== 0) {
    throw new Error('the real host empty response was not a 200 {ok:true, notes:[]}: ' + JSON.stringify(summary));
  }
  const empty = await capture(page, '10-empty');
  if (empty.youShouldKnowNodes !== 0) throw new Error('an empty session still renders a You should know element');
  if (empty.emptyStateNodes !== 0) throw new Error('an empty session still renders an empty-state element');
  if (empty.hasNoNotesYet) throw new Error('an empty session still shows No notes yet');
  if (empty.dockSlot === null || empty.dockSlot.height !== 0 || empty.dockSlot.width !== 0) throw new Error('the dock slot still occupies layout: ' + JSON.stringify(empty.dockSlot));
  if (empty.dockSlotChildren !== 0) throw new Error('the dock slot still has rendered children in the empty state');

  await page.route('**/api/dsh-you-should-know/notes**', (route) => {
    const notes = mode === 'populated' ? [NOTE] : [];
    const historyCount = mode === 'populated' ? 1 : (mode === 'history' ? HISTORY.length : 0);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, notes: notes, historyCount: historyCount }) });
  });
  await page.route('**/api/dsh-you-should-know/history**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history: mode === 'history' ? HISTORY : [] }) }));

  mode = 'populated';
  await page.waitForFunction(() => { const s = document.querySelector('[data-slot="conversation.input.dock"]'); return s !== null && s.children.length > 0; }, null, { timeout: 25000 });
  await page.waitForFunction((text) => document.body.innerText.includes(text), 'keeps polling after the host restarted', { timeout: 25000 });
  await sleep(1500);
  const populated = await capture(page, '11-populated');
  if (populated.youShouldKnowNodes < 1 || populated.noteCards < 1) throw new Error('the populated dock did not render the note card');
  if (!populated.bodyText.includes('You should know')) throw new Error('the populated dock lost its heading');
  if (!populated.bodyText.includes('keeps polling after the host restarted')) throw new Error('the populated dock lost the note content');
  if (!populated.actions.addToChat || !populated.actions.dismiss) throw new Error('the populated dock lost its actions');
  if (populated.hasNoNotesYet) throw new Error('the populated dock still shows the empty-state text');
  if (populated.dockContent === null || populated.dockContent.height <= 0) throw new Error('the populated dock has no layout box');

  mode = 'history';
  await page.waitForFunction(() => !document.body.innerText.includes('keeps polling after the host restarted') && Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'History'), null, { timeout: 25000 });
  await sleep(1000);
  await dismissModal(page);
  const historyToggle = page.getByRole('button', { name: 'History' }).first();
  try { await historyToggle.click({ timeout: 8000 }); } catch (error) { await page.keyboard.press('Escape').catch(() => {}); await sleep(500); await historyToggle.click({ timeout: 8000, force: true }); }
  try { await page.waitForFunction(() => document.body.innerText.includes('State: Active'), null, { timeout: 15000 }); } catch (error) { console.log('history wait note: ' + String(error && error.message).split(' ')[0]); }
  await sleep(1500);
  const history = await capture(page, '12-history');
  if (!history.bodyText.includes('State: Active')) throw new Error('the history panel did not show its entries');

  const hide = page.getByRole('button', { name: 'Hide notification history' });
  if (await hide.count() > 0) { try { await hide.first().click({ timeout: 8000 }); } catch (error) { /* already closed */ } await sleep(800); }
  mode = 'empty';
  await page.waitForFunction(() => { const s = document.querySelector('[data-slot="conversation.input.dock"]'); return s !== null && s.children.length === 0 && !document.body.innerText.includes('You should know'); }, null, { timeout: 25000 });
  await sleep(1200);
  const again = await capture(page, '13-empty-again');
  if (again.youShouldKnowNodes !== 0 || again.noteCards !== 0 || again.hasNoNotesYet) throw new Error('the dock did not return to the hidden empty state');
  if (again.dockSlotChildren !== 0) throw new Error('the dock slot kept children after the note was removed');

  await browser.close();

  const files = fs.readdirSync(OUT).filter((name) => name !== 'provenance.json').sort();
  const manifest = files.map((name) => { const data = fs.readFileSync(path.join(OUT, name)); return { path: name, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length }; });
  const provenance = {
    task_id: process.env.TASK_ID || 'ysk-hide-empty-banner-20261013',
    revision: 1,
    captured_at_utc: new Date().toISOString(),
    captured_by: process.env.CAPTURED_BY || 'DeepSeek Harness, supervised goal',
    product_commit: process.env.PRODUCT_COMMIT || null,
    base_commit: process.env.BASE_COMMIT || null,
    host: {
      app: process.env.HOST_APP || 'DeepSeek Harness.app',
      host_version: process.env.HOST_VERSION || null,
      invocation: process.env.DSH_INVOCATION || null,
      isolated_home: process.env.DSH_HOME || null,
      managed_profile_touched: false,
    },
    plugin: { source: 'task worktree at branch fix/ysk-hide-empty-banner', lib_client_sha256: process.env.LIB_CLIENT_SHA || null },
    browser: {
      engine: 'chrome-headless-shell (chromium 1243)',
      driver: 'playwright, loaded through PLAYWRIGHT_MODULE',
      viewport: '1280x900, deviceScaleFactor 2',
      script: 'capture.cjs',
    },
    data_control: {
      empty: 'NO interception. Rendered from the real authenticated host route GET api/dsh-you-should-know/notes; the observed response is recorded in empty-host-response.json.',
      populated: 'notes fulfilled at the browser HTTP boundary AFTER the empty capture, with one critical note.',
      history: 'notes + history fulfilled at the browser HTTP boundary AFTER the empty capture, with one active and one dismissed entry.',
      empty_again: 'both routes fulfilled empty AFTER the populated capture, proving the empty -> populated -> empty transitions on the same page.',
    },
    files: manifest,
  };
  fs.writeFileSync(path.join(OUT, 'provenance.json'), JSON.stringify(provenance, null, 2));
  console.log('notes source: empty = real host route; populated/history/empty-again = HTTP fixtures');
})().catch((error) => { console.error('FAILED: ' + String(error && error.message).split(String.fromCharCode(10))[0]); process.exit(1); });