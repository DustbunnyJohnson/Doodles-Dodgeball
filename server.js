// Doodles Stickman Dodgeball: tiny server (no installs needed, just Node 16+).
// Run:  node server.js     then open http://localhost:3000
// It serves index.html and relays online 1v1 messages over a WebSocket at /ws.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else { res.writeHead(404); res.end('Not found'); }
});

// ---- minimal WebSocket (RFC 6455) ----
function send(sock, obj) {
  if (!sock || sock.destroyed) return;
  const p = Buffer.from(JSON.stringify(obj));
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  sock.write(Buffer.concat([h, p]));
}

const rooms = new Map(); // code -> { host, guest }
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}
function leave(sock) {
  const r = sock.room; if (!r) return;
  sock.room = null;
  const other = sock.role === 'host' ? r.guest : r.host;
  if (other) { send(other, { t: 'peerleft' }); other.room = null; }
  rooms.delete(r.code);
}
function onMessage(sock, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (m.t === 'create') {
    leave(sock);
    const code = newCode(), r = { code, host: sock, guest: null };
    rooms.set(code, r); sock.room = r; sock.role = 'host';
    send(sock, { t: 'created', code });
  } else if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().trim(), r = rooms.get(code);
    if (!r) return send(sock, { t: 'err', msg: 'No room with that code.' });
    if (r.guest) return send(sock, { t: 'err', msg: 'That room is full.' });
    leave(sock);
    r.guest = sock; sock.room = r; sock.role = 'guest';
    send(sock, { t: 'joined', code });
    send(r.host, { t: 'peer' });
  } else if (sock.room) {
    const r = sock.room, other = sock.role === 'host' ? r.guest : r.host;
    if (other) send(other, m); // everything else is relayed to the other player
  }
}

server.on('upgrade', (req, sock) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  let buf = Buffer.alloc(0), frag = [];
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f, masked = !!(buf[1] & 0x80);
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { sock.destroy(); return; }
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4;
      const payload = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.slice(off + len);
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; } // ping -> pong
      if (op === 1 || op === 0) {
        frag.push(payload);
        if (fin) { const text = Buffer.concat(frag).toString('utf8'); frag = []; onMessage(sock, text); }
      }
    }
  });
  const gone = () => leave(sock);
  sock.on('close', gone); sock.on('error', gone);
});

server.listen(PORT, () => console.log('Stickman Dodgeball running at http://localhost:' + PORT));
