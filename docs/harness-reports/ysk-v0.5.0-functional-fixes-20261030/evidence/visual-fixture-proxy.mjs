// Synthetic notes/history fixture proxy for the actual-host visual capture.
// Purpose: forward HTTP and WebSocket traffic to the isolated DSH web host and
// replace ONLY /api/dsh-you-should-know/notes and /history with synthetic
// fixtures. The application shell, plugin bundles, session, composer, cards,
// and every interaction are served by the real host.
//
// Required environment: YSK_HOST_LOG points at the host boot log. The proxy
// reads the ephemeral launch token from that log to bootstrap browser auth and
// never writes the token to this file, to a screenshot, or to the evidence.
//
// The fixtures include two hostile payloads: a traversal source path and a
// note carrying U+202E/U+202C. They exist only in this test proxy.

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

const LISTEN_PORT = 51509;
const TARGET = { host: '127.0.0.1', port: 51508 };
const HOST_LOG = process.env.YSK_HOST_LOG || '';
const TOKEN = HOST_LOG ? (fs.readFileSync(HOST_LOG, 'utf8').match(/token=([A-Za-z0-9._~-]+)/) || [])[1] : '';

const NOTES = [
  {
    id: 'e2e-he-1',
    note: 'הקובץ lib/core.js:42 לא נטען כי הבקשה נכשלה, ולכן הבדיקה נשארה ללא מקור.',
    importance: 'critical',
    createdAt: 1793400000000,
    action: 'Fix the reviewer deadline in lib/core.js and add a regression test.',
    source: { path: 'lib/core.js', line: 42 },
    kind: 'defect',
    because: 'הבקשה נכשלה',
    explanation: 'הבקשה נכשלה לפני שהקובץ נטען, ולכן המסך נשאר ריק.',
  },
  {
    id: 'e2e-ar-2',
    note: 'الملف lib/language.js:30 لم يتم تحميله لأن الطلب فشل.',
    importance: 'high',
    createdAt: 1793400001000,
    source: { path: 'lib/language.js', line: 30 },
    kind: 'defect',
    explanation: 'فشل الطلب قبل تحميل الملف، لذلك بقيت الشاشة فارغة.',
  },
  {
    id: 'e2e-he-long',
    note: 'הפונקציה getSession מחזירה 400 עבור src/live-bridge.js כאשר הבקשה נשלחת בלי גוף, ולכן כל ניסיון שחזור של הסשן נכשל והמסך נשאר ריק גם אחרי רענון מלא של הדף.',
    importance: 'high',
    createdAt: 1793400002000,
    source: { path: 'src/very/long/nested/path/that/keeps/going/without/any/break/live-bridge.js', line: 123 },
    sourcePathRejected: false,
    explanation: 'הבקשה נשלחת בלי גוף, ולכן השרת מחזיר 400 וכל ניסיון השחזור נכשל.',
  },
  {
    id: 'e2e-traversal',
    note: 'Traversal fixture: the source path must never become a resource link.',
    importance: 'high',
    createdAt: 1793400003000,
    source: { path: '../../etc/passwd', line: 1 },
    action: 'Inspect the generated address for the traversal fixture.',
    explanation: 'The client fails closed on a traversal path.',
  },
  {
    id: 'e2e-bidi',
    note: 'Bidi fixture: invoice \u202Egnp.exe\u202C must render as plain text, not as a spoofed name.',
    importance: 'high',
    createdAt: 1793400004000,
    action: 'Confirm the bidi controls are stripped from the card and the draft.',
    explanation: 'The client strips bidi formatting controls from reviewer text.',
  },
];

const HISTORY = [
  {
    id: 'e2e-hist-1',
    note: 'הבקשה נכשלה לפני שהקובץ נטען, ולכן המסך נשאר ריק.',
    importance: 'high',
    createdAt: 1793399999000,
    resolved: true,
    resolution: 'thanks',
    resolvedAt: 1793400002000,
    explanation: 'ההסבר נשמר בהיסטוריה.',
  },
];

function rewriteHeaders(headers) {
  const out = { ...headers, host: '127.0.0.1:51508' };
  if (typeof out.origin === 'string') out.origin = 'http://127.0.0.1:51508';
  if (typeof out.referer === 'string') out.referer = out.referer.replace('127.0.0.1:51509', '127.0.0.1:51508');
  return out;
}

function upstreamPath(reqUrl, headers = {}) {
  if (!TOKEN) return reqUrl;
  const cookie = typeof headers.cookie === 'string' ? headers.cookie : '';
  if (cookie.includes('dsh-auth-')) return reqUrl;
  const url = new URL(reqUrl, 'http://127.0.0.1:51509');
  if (!url.searchParams.has('token')) url.searchParams.set('token', TOKEN);
  return url.pathname + url.search;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:51509');
  if (url.pathname === '/api/dsh-you-should-know/notes') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, notes: NOTES, historyCount: HISTORY.length }));
    return;
  }
  if (url.pathname === '/api/dsh-you-should-know/history') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, history: HISTORY }));
    return;
  }
  const upstream = http.request({ host: TARGET.host, port: TARGET.port, method: req.method, path: upstreamPath(req.url, req.headers), headers: rewriteHeaders(req.headers) }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.on('error', () => { try { res.destroy(); } catch {} });
    up.pipe(res);
  });
  res.on('error', () => { try { upstream.destroy(); } catch {} });
  upstream.on('error', () => { try { res.writeHead(502); res.end('proxy error'); } catch {} });
  req.on('error', () => { try { upstream.destroy(); } catch {} });
  req.pipe(upstream);
});

server.on('clientError', (error, socket) => { try { socket.destroy(); } catch {} });
process.on('uncaughtException', (error) => { try { console.error('proxy uncaught: ' + error.message); } catch {} });

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(TARGET.port, TARGET.host, () => {
    const headers = rewriteHeaders(req.headers);
    let raw = req.method + ' ' + upstreamPath(req.url, req.headers) + ' HTTP/1.1\r\n';
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) for (const item of v) raw += k + ': ' + item + '\r\n';
      else raw += k + ': ' + v + '\r\n';
    }
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  socket.on('error', () => { try { upstream.destroy(); } catch {} });
  upstream.on('error', () => { try { socket.destroy(); } catch {} });
  socket.on('close', () => { try { upstream.destroy(); } catch {} });
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log('proxy listening on ' + LISTEN_PORT + ' token=' + (TOKEN ? 'loaded' : 'missing'));
});
