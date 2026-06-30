// api/orders.js — Vercel Serverless: GET snapshot / POST event
// Data disimpan di memory global (bertahan selama instance hidup)
// Untuk persistensi penuh, sambungkan Vercel KV / Upstash Redis

// Simpanan in-memory. Vercel bisa menjalankan beberapa instance, tapi
// untuk demo hotel ini sudah lebih dari cukup.
if (!global._asteriaOrders) global._asteriaOrders = {};
if (!global._asteriaSeq)    global._asteriaSeq    = 0;

function getOrders() { return global._asteriaOrders; }
function getSeq()    { return global._asteriaSeq; }

function applyEvent(action, room, oid, payload) {
  if (!oid) return;
  if (action === 'create') {
    global._asteriaOrders[oid] = payload;
  } else {
    global._asteriaOrders[oid] = Object.assign(
      {},
      global._asteriaOrders[oid] || { id: oid, room },
      payload
    );
  }
  global._asteriaSeq++;
}

export default function handler(req, res) {
  // CORS — izinkan semua origin (sesuaikan jika perlu)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    // Kembalikan snapshot + nomor urut (seq) saat ini
    res.status(200).json({ seq: getSeq(), orders: getOrders() });
    return;
  }

  if (req.method === 'POST') {
    const { action, room, oid, payload } = req.body || {};
    if (!oid) {
      res.status(400).json({ error: 'oid wajib diisi' });
      return;
    }
    applyEvent(action, room, oid, payload || {});
    res.status(200).json({ ok: true, seq: getSeq() });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
