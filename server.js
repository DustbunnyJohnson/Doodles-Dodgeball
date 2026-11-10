// Doodles Stickman Dodgeball: tiny server (no installs needed, just Node 16+).
// Run:  node server.js     then open http://localhost:3000
// It serves index.html and runs online rooms (up to 6 players) over a WebSocket at /ws.
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

// ---- rooms: the host (id 0, team 0) runs the match; guests (ids 1-5) send inputs and get snapshots ----
const rooms = new Map(); // code -> { code, host, guests: Map(id -> sock), size, started }
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}
const players = r => [{ id: 0, team: 0 }].concat([...r.guests.entries()].sort((a, b) => a[0] - b[0]).map(([id, s]) => ({ id, team: s.team })));
const teamCount = (r, team) => players(r).filter(p => p.team === team).length;
const everyone = r => [r.host, ...r.guests.values()];
const lobby = r => ({ t: 'lobby', size: r.size, players: players(r) });
function broadcastLobby(r) { const m = lobby(r); everyone(r).forEach(s => send(s, m)); }
function leave(sock) {
  const r = sock.room; if (!r) return;
  sock.room = null;
  if (sock.role === 'host') {
    for (const g of r.guests.values()) { send(g, { t: 'hostleft' }); g.room = null; }
    rooms.delete(r.code);
  } else {
    r.guests.delete(sock.id);
    if (r.started) send(r.host, { t: 'left', id: sock.id }); else broadcastLobby(r);
  }
}
function onMessage(sock, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  const r = sock.room;
  if (m.t === 'create') {
    leave(sock);
    const code = newCode(), room = { code, host: sock, guests: new Map(), size: Math.min(3, Math.max(1, m.size | 0 || 3)), started: false };
    rooms.set(code, room); sock.room = room; sock.role = 'host'; sock.id = 0; sock.team = 0;
    send(sock, { t: 'created', code, id: 0 }); broadcastLobby(room);
  } else if (m.t === 'join') {
    const code = String(m.code || '').toUpperCase().trim(), room = rooms.get(code);
    if (!room) return send(sock, { t: 'err', msg: 'No room with that code.' });
    if (room.started) return send(sock, { t: 'err', msg: 'That match already started.' });
    const c0 = teamCount(room, 0), c1 = teamCount(room, 1);
    let team = c1 <= c0 ? 1 : 0;
    if ((team === 1 ? c1 : c0) >= room.size) team = 1 - team;
    if ((team === 1 ? c1 : c0) >= room.size) return send(sock, { t: 'err', msg: 'That room is full.' });
    leave(sock);
    let id = 1; while (room.guests.has(id)) id++;
    sock.room = room; sock.role = 'guest'; sock.id = id; sock.team = team; room.guests.set(id, sock);
    send(sock, { t: 'joined', code, id }); broadcastLobby(room);
  } else if (!r) {
    return;
  } else if (m.t === 'size' && sock.role === 'host' && !r.started) {
    const n = Math.min(3, Math.max(1, m.n | 0));
    if (n < Math.max(teamCount(r, 0), teamCount(r, 1))) return send(sock, { t: 'err', msg: 'Too many players for that size.' });
    r.size = n; broadcastLobby(r);
  } else if (m.t === 'team' && sock.role === 'guest' && !r.started) {
    const to = 1 - sock.team;
    if (teamCount(r, to) >= r.size) return send(sock, { t: 'err', msg: 'That team is full.' });
    sock.team = to; broadcastLobby(r);
  } else if (m.t === 'start' && sock.role === 'host') {
    if (players(r).length < 2) return send(sock, { t: 'err', msg: 'Need at least 2 players.' });
    r.started = true;
    const base = { t: 'start', size: r.size, players: players(r) };
    everyone(r).forEach(s => send(s, Object.assign({ you: s.id }, base)));
  } else if (!['create', 'join', 'size', 'team', 'start'].includes(m.t)) {
    // everything else is gameplay traffic: host -> all guests, guest -> host (tagged with who sent it)
    if (sock.role === 'host') for (const g of r.guests.values()) send(g, m);
    else { m.from = sock.id; send(r.host, m); }
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
