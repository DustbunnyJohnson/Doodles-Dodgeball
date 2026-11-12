// Stickman Dodgeball: tiny web server + multiplayer relay. No dependencies, just Node 18+.
// Serves index.html at "/" and relays game messages over a WebSocket at "/ws".
// The host's browser runs the match; this server only manages rooms and passes messages along.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 64 * 1024;
const rooms = new Map();

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html missing'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/healthz') { res.writeHead(200); res.end('ok'); }
  else { res.writeHead(404); res.end('Not found'); }
});

// ---- minimal WebSocket (RFC 6455) ----
function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function send(c, obj) {
  if (!c || c.sock.destroyed || !c.sock.writable) return;
  try { c.sock.write(frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))); } catch (e) {}
}

server.on('upgrade', (req, sock) => {
  const url = (req.url || '').split('?')[0];
  const key = req.headers['sec-websocket-key'];
  if (url !== '/ws' || !key) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, id: -1, team: 0, room: null };
  let buf = Buffer.alloc(0), frag = [];
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) { sock.destroy(); return; }
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      let payload;
      if (masked) { const m = buf.subarray(off, off + 4); payload = Buffer.from(buf.subarray(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) payload[i] ^= m[i & 3]; off += 4 + len; }
      else { payload = Buffer.from(buf.subarray(off, off + len)); off += len; }
      buf = buf.subarray(off);
      if (op === 8) { try { sock.write(frame(8, Buffer.alloc(0))); } catch (e) {} sock.end(); return; }
      if (op === 9) { try { sock.write(frame(10, payload)); } catch (e) {} continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) {
        frag.push(payload);
        if (fin) { const full = Buffer.concat(frag); frag = []; onText(c, full.toString('utf8')); }
      }
    }
  });
  const gone = () => { if (c.dead) return; c.dead = true; leave(c); };
  sock.on('close', gone); sock.on('error', gone);
});

// ---- rooms ----
function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(s)) return s; }
}
const players = r => [...r.members.values()].map(m => ({ id: m.id, team: m.team }));
const teamCount = (r, t) => [...r.members.values()].filter(m => m.team === t).length;
function lobby(r) { const msg = { t: 'lobby', size: r.size, players: players(r) }; for (const m of r.members.values()) send(m, msg); }

function onText(c, text) {
  let m; try { m = JSON.parse(text); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  const r = c.room;
  switch (m.t) {
    case 'create': {
      if (r) return;
      const size = Math.min(3, Math.max(1, m.size | 0 || 1));
      const code = makeCode(), room = { code, size, host: c, members: new Map(), started: false };
      c.id = 0; c.team = 0; c.room = room; room.members.set(0, c); rooms.set(code, room);
      send(c, { t: 'created', code, id: 0 }); lobby(room); return;
    }
    case 'join': {
      if (r) return;
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(c, { t: 'err', msg: 'No room with that code.' });
      if (room.started) return send(c, { t: 'err', msg: 'That game already started.' });
      if (room.members.size >= room.size * 2) return send(c, { t: 'err', msg: 'That room is full.' });
      let id = 1; while (room.members.has(id)) id++;
      const t1 = teamCount(room, 1), t0 = teamCount(room, 0);
      c.team = t1 < room.size && t1 <= t0 ? 1 : 0;
      c.id = id; c.room = room; room.members.set(id, c);
      send(c, { t: 'joined', code: room.code, id }); lobby(room); return;
    }
    case 'size': {
      if (!r || r.host !== c || r.started) return;
      const n = Math.min(3, Math.max(1, m.n | 0 || 1));
      if (r.members.size > n * 2) return send(c, { t: 'err', msg: 'Too many players for that size.' });
      r.size = n;
      for (const t of [0, 1]) { // rebalance if a team is now too big
        for (const mem of [...r.members.values()].reverse()) { if (mem.team === t && teamCount(r, t) > n && mem.id !== 0) mem.team = 1 - t; }
      }
      lobby(r); return;
    }
    case 'team': {
      if (!r || r.host === c || r.started) return;
      const to = 1 - c.team; if (teamCount(r, to) < r.size) { c.team = to; lobby(r); } return;
    }
    case 'start': {
      if (!r || r.host !== c || r.started || r.members.size < 2) return;
      r.started = true;
      for (const mem of r.members.values()) send(mem, { t: 'start', size: r.size, players: players(r), you: mem.id });
      return;
    }
    default: {
      if (!r || !r.started) return;
      if (r.host === c) { if (m.t === 's') for (const mem of r.members.values()) if (mem !== c) send(mem, text); }
      else { m.from = c.id; send(r.host, m); }
    }
  }
}
function leave(c) {
  const r = c.room; if (!r) return; c.room = null;
  if (r.host === c) {
    for (const mem of r.members.values()) if (mem !== c) { mem.room = null; send(mem, { t: 'hostleft' }); }
    rooms.delete(r.code); return;
  }
  r.members.delete(c.id);
  if (r.started) send(r.host, { t: 'left', id: c.id }); else lobby(r);
}

setInterval(() => { for (const r of rooms.values()) for (const m of r.members.values()) { try { m.sock.write(frame(9, Buffer.alloc(0))); } catch (e) {} } }, 25000);
server.listen(PORT, () => console.log('Stickman Dodgeball listening on port ' + PORT));
