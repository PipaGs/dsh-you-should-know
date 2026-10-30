import http from 'node:http';
import net from 'node:net';

const LISTEN_PORT = 51509;
const TARGET = { host: '127.0.0.1', port: 51508 };
const NOTES = [
  {
    id: 'vis-he-1',
    note: 'הקובץ lib/runtime.js:42 לא נטען כי הבקשה נכשלה.',
    importance: 'critical',
    createdAt: 1793373000000,
    action: 'Fix the session restore path in lib/runtime.js and add a regression test.',
    source: { path: 'lib/runtime.js', line: 42 },
    explanation: 'הבקשה נכשלה לפני שהקובץ נטען, ולכן המסך נשאר ריק.',
  },
  {
    id: 'vis-ar-2',
    note: 'الملف lib/language.js:30 لم يتم تحميله لأن الطلب فشل.',
    importance: 'high',
    createdAt: 1793373001000,
    source: { path: 'lib/language.js', line: 30 },
    explanation: 'فشل الطلب قبل تحميل الملف، لذلك بقيت الشاشة فارغة.',
  },
  {
    id: 'vis-he-long',
    note: 'הפונקציה getSession מחזירה 400 עבור src/live-bridge.js כאשר הבקשה נשלחת בלי גוף, ולכן כל ניסיון שחזור של הסשן נכשל והמסך נשאר ריק גם אחרי רענון מלא של הדף.',
    importance: 'high',
    createdAt: 1793373002000,
    source: { path: 'src/very/long/nested/path/that/keeps/going/without/any/break/live-bridge.js', line: 123 },
    explanation: 'הבקשה נשלחת בלי גוף, ולכן השרת מחזיר 400 וכל ניסיון השחזור נכשל.',
  },
];
const HISTORY = [
  {
    id: 'vis-hist-1',
    note: 'הבקשה נכשלה לפני שהקובץ נטען, ולכן המסך נשאר ריק.',
    importance: 'high',
    createdAt: 1793372999000,
    resolved: true,
    resolution: 'thanks',
    resolvedAt: 1793373002000,
    explanation: 'ההסבר נשמר בהיסטוריה.',
  },
];

function rewriteHeaders(headers) {
  const out = { ...headers, host: '127.0.0.1:51508' };
  if (typeof out.origin === 'string') out.origin = 'http://127.0.0.1:51508';
  if (typeof out.referer === 'string') out.referer = out.referer.replace('127.0.0.1:51509', '127.0.0.1:51508');
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:51509');
  if (url.pathname === '/api/dsh-you-should-know/notes') {
    const body = JSON.stringify({ ok: true, notes: NOTES, historyCount: HISTORY.length });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  if (url.pathname === '/api/dsh-you-should-know/history') {
    const body = JSON.stringify({ ok: true, history: HISTORY });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  const upstream = http.request({ host: TARGET.host, port: TARGET.port, method: req.method, path: req.url, headers: rewriteHeaders(req.headers) }, (up) => {
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
    let raw = req.method + ' ' + req.url + ' HTTP/1.1\r\n';
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
  console.log('visual proxy listening on ' + LISTEN_PORT);
});
