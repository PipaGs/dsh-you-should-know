#!/usr/bin/env node
/*
 * Native visual + interaction capture for the bounded notification-history panel.
 *
 *   node capture-history.cjs <url-with-token> <output-dir> <label>
 *
 * The page is the real DeepSeek Harness Web GUI served by an isolated profile
 * whose dsh-you-should-know bundle is a symlink to the task worktree. Only the
 * plugin's own HTTP routes are answered with fixtures, so the conversation
 * shell, the sticky composer seat and the dock are the host's own layout.
 *
 * It records:
 *   - the viewport height and the geometry of the sticky composer seat,
 *   - the History toggle's rect before and after scrolling the conversation to
 *     its top, which is the only escape an unbounded panel leaves a user,
 *   - a real Playwright click on the toggle and whether the panel closed,
 *   - screenshots of the full page and of the dock region,
 *   - the sha256 of the plugin's lib/client.js that the instance served.
 *
 * PLAYWRIGHT_MODULE / PLAYWRIGHT_BROWSERS_PATH are honoured exactly as in the
 * earlier capture harness; no machine path is baked in.
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

function loadPlaywright() {
  const explicit = process.env.PLAYWRIGHT_MODULE
  if (explicit !== undefined && explicit !== '') return require(explicit)
  return require('playwright')
}

function findExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  if (!fs.existsSync(root)) return undefined
  const names = fs.readdirSync(root).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse()
  for (const name of names) {
    for (const triple of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64', 'chrome-headless-shell-win64']) {
      const candidate = path.join(root, name, triple, 'chrome-headless-shell')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const URL_ARG = process.argv[2]
const OUT = process.argv[3]
const LABEL = process.argv[4] || 'run'
// The captured plugin tree; defaults to this repository, so the script carries
// no machine path. Point PLUGIN_DIR at a pre-fix tree to capture the red state.
const PLUGIN = process.env.PLUGIN_DIR || path.resolve(__dirname, '..', '..', '..', '..')
// Twelve entries: the panel is taller than a 900px viewport at ~90px a row, and
// this is above the nine entries the reporter had when the toggle disappeared.
const ENTRIES = Array.from({ length: 12 }, (_, index) => ({
  id: 'viz-entry-' + index,
  note: 'Fixture finding ' + (index + 1) + ': the notification history grows without a height bound, so the composer seat is pushed past the viewport.',
  importance: index === 0 ? 'critical' : 'high',
  createdAt: 1700000000000 - index * 60000,
  resolved: index % 2 === 0,
  ...(index % 2 === 0 ? { resolution: 'dismissed', resolvedAt: 1700000000000 - index * 60000 + 1000 } : {}),
  source: { path: 'lib/client.js', line: 1000 + index },
}))

async function dismissModal(page) {
  for (const label of ['Configure later', 'Continue', 'Close']) {
    const button = page.getByRole('button', { name: label })
    if (await button.count() > 0) {
      try { await button.first().click({ timeout: 4000 }) } catch (error) { /* the overlay may already be gone */ }
      await sleep(400)
    }
  }
  await sleep(200)
}

async function geometry(page) {
  return await page.evaluate(() => {
    const viewportHeight = window.innerHeight
    const toggle = document.querySelector('[aria-label="Show notification history"], [aria-label="Hide notification history"]')
    const group = document.querySelector('[role="group"][aria-label="Notification history"]')
    const seat = document.querySelector('[data-composer-seat]')
    const scroller = document.querySelector('[data-conversation-scroll]')
    const rect = (node) => {
      if (node === null) return null
      const box = node.getBoundingClientRect()
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height), left: Math.round(box.left), width: Math.round(box.width) }
    }
    const inViewport = (box) => box !== null && box.top >= 0 && box.bottom <= viewportHeight
    return {
      viewportHeight,
      toggle: rect(toggle),
      toggleInViewport: inViewport(rect(toggle)),
      group: rect(group),
      groupStyle: group === null ? null : {
        maxHeight: getComputedStyle(group).maxHeight,
        overflowY: getComputedStyle(group).overflowY,
        scrollHeight: group.scrollHeight,
        clientHeight: group.clientHeight,
      },
      composerSeat: rect(seat),
      seatHeightExceedsViewport: (() => { const box = rect(seat); return box !== null && box.height > viewportHeight })(),
      scroll: scroller === null ? null : {
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
      },
    }
  })
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const { chromium } = loadPlaywright()
  const executablePath = findExecutable()
  const browser = await chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const evidence = {
    label: LABEL,
    capturedAt: new Date().toISOString(),
    url: URL_ARG.replace(/token=[^&]+/, 'token=<redacted>'),
    playwright: require(path.join(process.env.PLAYWRIGHT_MODULE || require.resolve('playwright'), 'package.json')).version,
    viewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
    fixture: { entries: ENTRIES.length, note: 'HTTP-boundary fixtures for the plugin routes only' },
    pluginClientSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(PLUGIN, 'lib/client.js'))).digest('hex'),
  }

  await page.goto(URL_ARG, { waitUntil: 'networkidle' })
  await sleep(1500)
  await dismissModal(page)
  const chooser = page.locator('[aria-label="Choose workspace"]')
  if (await chooser.count() > 0 && (await chooser.first().innerText()).trim() === 'Choose workspace') {
    await chooser.first().click()
    await sleep(600)
    const items = page.locator('[role="menuitem"]').filter({ hasNotText: 'Add workspace' })
    if (await items.count() > 0) {
      await items.first().click()
      await sleep(2500)
    }
  }
  await dismissModal(page)

  // A fresh isolated profile opens on the session-less hero; the dock slot is
  // session-scoped, so create the workspace's first session before installing
  // the route fixtures.
  if (await page.locator('[data-conversation-session]').count() === 0) {
    const newSession = page.getByRole('button', { name: 'New session in Default workspace' })
    if (await newSession.count() > 0) {
      await newSession.first().click({ timeout: 8000 })
      await sleep(3000)
    }
  }
  await dismissModal(page)

  await page.route('**/api/dsh-you-should-know/notes**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, notes: [], historyCount: ENTRIES.length }),
  }))
  await page.route('**/api/dsh-you-should-know/history**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, history: ENTRIES }),
  }))

  // The toggle carries "Show notification history" while the panel is closed
  // and "Hide notification history" while it is open.
  await page.waitForSelector('[aria-label="Show notification history"]', { timeout: 30000 })
  await page.getByRole('button', { name: 'Show notification history' }).first().click({ timeout: 10000 })
  await page.waitForSelector('[role="group"][aria-label="Notification history"]', { timeout: 15000 })
  await sleep(1200)

  evidence.beforeScroll = await geometry(page)
  await page.screenshot({ path: path.join(OUT, LABEL + '-1-after-open.png') })
  await page.screenshot({ path: path.join(OUT, LABEL + '-1-after-open-page.png'), fullPage: false })

  // The reporter's only escape: scroll the conversation to its top. Record what
  // that does to the toggle before any click is attempted.
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-conversation-scroll]')
    if (scroller !== null) scroller.scrollTop = 0
    window.scrollTo(0, 0)
  })
  await sleep(600)
  evidence.afterScrollToTop = await geometry(page)
  await page.screenshot({ path: path.join(OUT, LABEL + '-2-scrolled-to-top.png') })

  // A real pointer click, exactly what the reporter tried.
  const toggle = page.locator('[aria-label="Hide notification history"]').first()
  let clickOutcome
  const startedAt = Date.now()
  try {
    await toggle.click({ timeout: 8000 })
    clickOutcome = { ok: true, elapsedMs: Date.now() - startedAt }
  } catch (error) {
    clickOutcome = { ok: false, elapsedMs: Date.now() - startedAt, error: String(error && error.message).split('\n')[0] }
  }
  await sleep(800)
  evidence.click = clickOutcome
  evidence.afterClick = await geometry(page)
  evidence.panelClosed = await page.evaluate(() => document.querySelector('[role="group"][aria-label="Notification history"]') === null)
  evidence.toggleLabelAfterClick = await page.evaluate(() => {
    const node = document.querySelector('[aria-label="Show notification history"], [aria-label="Hide notification history"]')
    return node === null ? null : node.getAttribute('aria-label')
  })
  await page.screenshot({ path: path.join(OUT, LABEL + '-3-after-click.png') })

  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(evidence, null, 2) + '\n')
  await browser.close()
  console.log(JSON.stringify({ label: LABEL, panelClosed: evidence.panelClosed, click: evidence.click, toggleInViewport: evidence.beforeScroll.toggleInViewport, seatExceeds: evidence.beforeScroll.seatHeightExceedsViewport, sha: evidence.pluginClientSha256 }))
})().catch((error) => { console.error('FAILED:', String(error && error.message).split('\n')[0]); process.exit(1) })
