/* ════════════════════════════════════════════════════════════════
   Asteria Hotel — Beverage Room Service App
   Server statis + Realtime Sync (WebSocket, tanpa dependency npm)

   Server ini melakukan dua hal:
   1. Menyajikan file statis di folder public/ (seperti sebelumnya).
   2. Menjadi pusat sinkronisasi real-time: setiap pesanan / perubahan
      status yang dikirim oleh Guest App, Staff Dashboard, atau Runner
      Mobile disimpan ke disk (data/orders.json) lalu disiarkan ke
      SEMUA perangkat yang sedang terhubung lewat WebSocket di /ws.

   Tidak ada dependency npm yang dibutuhkan — implementasi WebSocket
   di bawah ini ditulis manual menggunakan modul bawaan Node.js
   (http, crypto) sesuai RFC 6455.
════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/* ─────────────────────────────────────────────
   PENYIMPANAN PESANAN (persisten ke disk)
   Key: order id (oid)  →  Value: objek pesanan lengkap
───────────────────────────────────────────── */
let ORDERS = {};

function loadOrders() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      ORDERS = raw ? JSON.parse(raw) : {};
      console.log(`Memuat ${Object.keys(ORDERS).length} pesanan tersimpan dari ${DATA_FILE}`);
    }
  } catch (err) {
    console.error('Gagal memuat data pesanan, mulai dari kosong:', err.message);
    ORDERS = {};
  }
}

function saveOrders() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(ORDERS, null, 2));
  } catch (err) {
    console.error('Gagal menyimpan data pesanan:', err.message);
  }
}

loadOrders();

/* ─────────────────────────────────────────────
   HTTP SERVER — file statis (tidak berubah dari sebelumnya)
───────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

/* ─────────────────────────────────────────────
   WEBSOCKET SERVER (implementasi manual, RFC 6455)
───────────────────────────────────────────── */
const clients = new Set();

function acceptKeyFor(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

// Bingkai (frame) teks tanpa mask, dikirim dari server ke klien
function encodeFrame(payloadStr) {
  const payload = Buffer.from(payloadStr, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

function sendTo(socket, obj) {
  try {
    socket.write(encodeFrame(JSON.stringify(obj)));
  } catch (e) { /* socket mungkin sudah tertutup, abaikan */ }
}

function broadcast(obj) {
  const buf = encodeFrame(JSON.stringify(obj));
  clients.forEach((s) => {
    try { s.write(buf); } catch (e) { clients.delete(s); }
  });
}

// Membongkar (decode) satu atau lebih frame dari buffer masuk (dari klien, selalu masked)
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;

    if (len === 126) {
      if (pos + 2 > buffer.length) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(pos));
      pos += 8;
    }

    let maskKey = null;
    if (masked) {
      if (pos + 4 > buffer.length) break;
      maskKey = buffer.slice(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buffer.length) break; // frame belum lengkap, tunggu data berikutnya

    let payload = buffer.slice(pos, pos + len);
    if (masked && maskKey) {
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
      payload = unmasked;
    }

    if (opcode === 0x8) {
      messages.push(null); // close frame
    } else if (opcode === 0x1) {
      messages.push(payload.toString('utf8')); // text frame
    }
    // opcode 0x9 (ping) / 0xA (pong) diabaikan — tidak krusial untuk app ini

    offset = pos + len;
  }
  return { messages, rest: buffer.slice(offset) };
}

server.on('upgrade', (req, socket) => {
  if ((req.headers['upgrade'] || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = acceptKeyFor(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  clients.add(socket);
  sendTo(socket, { type: 'snapshot', orders: ORDERS });

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { messages, rest } = decodeFrames(buffer);
    buffer = rest;
    messages.forEach((msg) => {
      if (msg === null) { socket.end(); return; }
      let data;
      try { data = JSON.parse(msg); } catch (e) { return; }
      handleClientMessage(socket, data);
    });
  });
  socket.on('error', () => clients.delete(socket));
  socket.on('close', () => clients.delete(socket));
});

function handleClientMessage(socket, data) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'hello') {
    sendTo(socket, { type: 'snapshot', orders: ORDERS });
    return;
  }

  if (data.type === 'event') {
    const { action, room, oid, payload } = data;
    if (!oid) return;

    if (action === 'create') {
      ORDERS[oid] = payload;
    } else {
      ORDERS[oid] = Object.assign({}, ORDERS[oid] || { id: oid, room }, payload);
    }
    saveOrders();
    // Disiarkan ke SEMUA klien (termasuk pengirim) — idempotent di sisi klien
    broadcast({ type: 'event', action, room, oid, payload });
  }
}

server.listen(PORT, () => {
  console.log(`Asteria Hotel App running at http://localhost:${PORT}`);
  console.log(`Realtime sync (WebSocket) aktif — siap menyinkronkan Guest App, Staff Dashboard & Runner Mobile`);
});
