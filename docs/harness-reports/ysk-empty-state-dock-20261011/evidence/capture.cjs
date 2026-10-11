#!/usr/bin/env node
/*
 * Visual capture for the dsh-you-should-know composer dock.
 *
 *   node capture.cjs <url-with-token> <output-dir>
 *
 * Environment (all optional; the script holds no machine-specific path):
 *   PLAYWRIGHT_MODULE        module id or path of the playwright package
 *                            (default: require('playwright'))
 *   PLAYWRIGHT_BROWSERS_PATH browsers root; default is Playwright's own
 *                            <home>/Library/Caches/ms-playwright on macOS
 *   CHROMIUM_PATH            explicit chrome-headless-shell executable
 *
 * Fidelity:
 *   - The EMPTY state is captured with NO request interception, so it renders
 *     from the real authenticated host route GET api/dsh-you-should-know/notes.
 *     Every notes response seen before that capture is written to
 *     empty-host-response.json (status + body shape).
 *   - Only AFTER the empty capture does the script install deterministic
 *     fixtures at the browser HTTP boundary for the pending and history states.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_MODULE;
  if (explicit !== undefined && explicit !== '') return require(explicit);
  return require('playwright');
}

function findExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
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

async function dismissModal(page) {
  // The first run of a fresh profile shows the API-key prompt and the welcome
  // notice; both are dismissed without configuring a provider.
  for (const label of ['Configure later', 'Continue']) {
    const button = page.getByRole('button', { name: label });
    if (await button.count() > 0) {
      try { await button.first().click({ timeout: 4000 }); } catch (error) { /* the overlay may already be gone */ }
      await sleep(400);
    }
  }
  await sleep(200);
}

async function dockBox(page) {
  return await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[aria-label="You should know"], [role="group"][aria-label="Notification history"], [aria-label="Hide notification history"], [aria-label="Show notification history"]'));
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9, found = false;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      found = true;
      x1 = Math.min(x1, rect.left); y1 = Math.min(y1, rect.top);
      x2 = Math.max(x2, rect.right); y2 = Math.max(y2, rect.bottom);
    }
    return found ? { x: Math.max(0, x1 - 10), y: Math.max(0, y1 - 10), width: (x2 - x1) + 20, height: (y2 - y1) + 20 } : null;
  });
}

async function capture(page, name) {
  const box = await dockBox(page);
  if (box !== null) await page.screenshot({ path: path.join(OUT, name + '.png'), clip: box });
  await page.screenshot({ path: path.join(OUT, name + '-page.png') });
  const evidence = await page.evaluate(() => ({
    dockHtml: Array.from(document.querySelectorAll('[aria-label="You should know"], [role="group"][aria-label="Notification history"]')).map((node) => node.outerHTML),
    bodyText: document.body.innerText,
  }));
  fs.writeFileSync(path.join(OUT, name + '.html'), evidence.dockHtml.join('\n\n<!-- --- -->\n\n'));
  fs.writeFileSync(path.join(OUT, name + '.txt'), evidence.bodyText);
  console.log('captured', name, 'box=' + JSON.stringify(box));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const executablePath = findExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  // Record the real host responses BEFORE any interception exists.
  const realNotes = [];
  page.on('response', async (response) => {
    if (!response.url().includes('/api/dsh-you-should-know/notes')) return;
    let body = null;
    let error = null;
    try { body = await response.json(); } catch (caught) { error = String(caught && caught.message); }
    realNotes.push({ status: response.status(), body, error });
  });

  await page.goto(URL_ARG, { waitUntil: 'networkidle' });
  await sleep(1500);
  await dismissModal(page);
  // The composer may already hold the seeded workspace from an earlier run.
  const chooser = page.locator('[aria-label="Choose workspace"]');
  if (await chooser.count() > 0 && (await chooser.first().innerText()).trim() === 'Choose workspace') {
    await chooser.first().click();
    await sleep(600);
    const items = page.locator('[role="menuitem"]').filter({ hasNotText: 'Add workspace' });
    if (await items.count() > 0) {
      await items.first().click();
      await sleep(2500);
    }
  }
  await dismissModal(page);
  await page.waitForSelector('[aria-label="You should know"]', { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes('No notes yet'), null, { timeout: 15000 });
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
  fs.writeFileSync(path.join(OUT, 'empty-host-response.json'), JSON.stringify(summary, null, 2) + '\n');
  if (summary.status !== 200 || summary.ok !== true || summary.notesIsArray !== true || summary.noteCount !== 0) {
    throw new Error('the real host empty response was not a 200 {ok:true, notes:[]}: ' + JSON.stringify(summary));
  }
  await capture(page, '10-empty');

  // Fixtures are installed only now, for the non-empty states.
  await page.route('**/api/dsh-you-should-know/notes**', (route) => {
    const notes = mode === 'pending' ? [NOTE] : [];
    const historyCount = mode === 'pending' ? 1 : (mode === 'history' ? HISTORY.length : 0);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, notes, historyCount }) });
  });
  await page.route('**/api/dsh-you-should-know/history**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history: mode === 'history' ? HISTORY : [] }) }));

  mode = 'pending';
  await page.waitForFunction((text) => document.body.innerText.includes(text), 'keeps polling after the host restarted', { timeout: 20000 });
  await sleep(1500);
  await capture(page, '11-pending');

  mode = 'history';
  await page.waitForFunction(() => !document.body.innerText.includes('keeps polling after the host restarted') && document.body.innerText.includes('History'), null, { timeout: 20000 });
  await sleep(1000);
  await dismissModal(page);
  const historyToggle = page.getByRole('button', { name: 'History' }).first();
  try {
    await historyToggle.click({ timeout: 8000 });
  } catch (error) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    await historyToggle.click({ timeout: 8000, force: true });
  }
  try {
    await page.waitForFunction(() => document.body.innerText.includes('State: Active'), null, { timeout: 15000 });
  } catch (error) {
    console.log('history wait note:', String(error && error.message).split('\n')[0]);
  }
  await sleep(1500);
  await capture(page, '12-history');

  await browser.close();
  console.log('notes source: empty = real host route; pending/history = HTTP fixtures');
})().catch((error) => { console.error('FAILED:', String(error && error.message).split('\n')[0]); process.exit(1); });
