
const fs = require('fs');
const { chromium } = require('/Users/pipags/.npm/_npx/381cec31605a419a/node_modules/playwright');
const EXEC = '/Users/pipags/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[3];
const NOW = Date.now();
const NOTE = { id: 'viz-note-1', note: 'The retry loop never clears its timer, so a disposed session keeps polling after the host restarted.', importance: 'critical', createdAt: NOW - 60000, action: 'Clear the polling timer in the session teardown and add a regression test for the disposed session.', source: { path: 'lib/runtime.js', line: 42 } };
const HISTORY = [
  { id: 'viz-note-1', note: 'The retry loop never clears its timer, so a disposed session keeps polling after the host restarted.', importance: 'critical', createdAt: NOW - 60000, resolved: false, source: { path: 'lib/runtime.js', line: 42 } },
  { id: 'viz-hist-1', note: 'A dismissed finding kept its resolved state and its source line.', importance: 'high', createdAt: NOW - 120000, resolved: true, resolution: 'dismissed', resolvedAt: NOW - 90000, source: { path: 'lib/core.js', line: 7 } },
];
let mode = 'empty';
async function dismissModal(page) { const later = page.getByRole('button', { name: 'Configure later' }); if (await later.count() > 0) { try { await later.first().click({ timeout: 4000 }); } catch (e) {} } await sleep(400); }
async function dockBox(page) {
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[aria-label="You should know"], [role="group"][aria-label="Notification history"], [aria-label="Hide notification history"], [aria-label="Show notification history"]'));
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9, found = false;
    for (const el of els) { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) continue; found = true; x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); }
    if (!found) return null;
    return { x: Math.max(0, x1 - 10), y: Math.max(0, y1 - 10), width: (x2 - x1) + 20, height: (y2 - y1) + 20 };
  });
}
async function capture(page, name, label) {
  const box = await dockBox(page);
  if (box) await page.screenshot({ path: OUT + '/' + name + '.png', clip: box });
  await page.screenshot({ path: OUT + '/' + name + '-page.png' });
  const evidence = await page.evaluate(() => ({
    dockHtml: Array.from(document.querySelectorAll('[aria-label="You should know"], [role="group"][aria-label="Notification history"]')).map((n) => n.outerHTML),
    bodyText: document.body.innerText,
  }));
  fs.writeFileSync(OUT + '/' + name + '.html', evidence.dockHtml.join('\n\n<!-- --- -->\n\n'));
  fs.writeFileSync(OUT + '/' + name + '.txt', evidence.bodyText);
  console.log('captured', name, label, 'box=' + JSON.stringify(box));
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: EXEC });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.route('**/api/dsh-you-should-know/notes**', (route) => {
    const notes = mode === 'pending' ? [NOTE] : [];
    const historyCount = mode === 'pending' ? 1 : (mode === 'history' ? HISTORY.length : 0);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, notes, historyCount }) });
  });
  await page.route('**/api/dsh-you-should-know/history**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, history: mode === 'history' ? HISTORY : [] }) }));
  await page.goto(process.argv[2], { waitUntil: 'networkidle' });
  await sleep(1500);
  await dismissModal(page);
  await page.locator('[aria-label="Choose workspace"]').first().click();
  await sleep(600);
  await page.locator('[role="menuitem"]').filter({ hasNotText: 'Add workspace' }).first().click();
  await sleep(2500);
  await dismissModal(page);
  await page.waitForSelector('[aria-label="You should know"]', { timeout: 15000 });
  await sleep(1000);
  await page.waitForFunction(() => document.body.innerText.includes('No notes yet'), null, { timeout: 15000 });
  await capture(page, '10-empty', 'no notes and no history');

  mode = 'pending';
  await page.waitForFunction((t) => document.body.innerText.includes(t), 'keeps polling after the host restarted', { timeout: 20000 });
  await sleep(1500);
  await capture(page, '11-pending', 'one active critical finding');

  mode = 'history';
  await page.waitForFunction(() => !document.body.innerText.includes('keeps polling after the host restarted') && document.body.innerText.includes('History'), null, { timeout: 20000 });
  await sleep(1500);
  await page.getByRole('button', { name: 'History' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Dismissed finding') || document.body.innerText.includes('dismissed finding') || document.body.innerText.includes('State: Dismissed'), null, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await capture(page, '12-history', 'history panel with a resolved and an active entry');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message.split('\n')[0]); process.exit(1); });
