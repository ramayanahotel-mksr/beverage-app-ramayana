// api/orders.js — Vercel Serverless: GET snapshot / POST event
//
// PENTING: data disimpan di Vercel KV (Upstash Redis) — BUKAN in-memory.
// In-memory (global._asteriaOrders) TIDAK reliable di Vercel karena
// setiap serverless instance bisa berbeda dan instance bisa di-recycle
// kapan saja, menyebabkan data "hilang" / tidak sinkron antar menu.
// Dengan KV, semua menu (Guest, Staff, Runner, Admin) membaca dari
// SATU sumber data yang sama dan benar-benar persisten.
//
// Setup yang dibutuhkan di Vercel:
//   1. Buka project di Vercel Dashboard → Storage → Create → KV
//   2. Hubungkan ke project ini (env var akan otomatis ditambahkan)
//   3. jalankan: npm install @vercel/kv
//
// Jika KV belum disambungkan, kode ini otomatis fallback ke in-memory
// (hanya untuk dev lokal / testing — TIDAK untuk production).

import { kv } from '@vercel/kv';

const HAS_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const ORDERS_KEY = 'asteria:orders'; // hash: oid -> JSON order
const SEQ_KEY = 'asteria:seq';       // integer counter

// ── Fallback in-memory (hanya dev lokal tanpa KV) ──
if (!global._asteriaOrders) global._asteriaOrders = {};
if (!global._asteriaSeq) global._asteriaSeq = 0;

async function getAllOrders() {
  if (HAS_KV) {
    const data = await kv.hgetall(ORDERS_KEY);
    return data || {};
  }
  return global._asteriaOrders;
}

async function getSeq() {
  if (HAS_KV) {
    const seq = await kv.get(SEQ_KEY);
    return seq || 0;
  }
  return global._asteriaSeq;
}

async function bumpSeq() {
  if (HAS_KV) {
    return await kv.incr(SEQ_KEY);
  }
  global._asteriaSeq++;
  return global._asteriaSeq;
}

async function setOrder(oid, order) {
  if (HAS_KV) {
    await kv.hset(ORDERS_KEY, { [oid]: JSON.stringify(order) });
  } else {
    global._asteriaOrders[oid] = order;
  }
}

async function deleteOrderKV(oid) {
  if (HAS_KV) {
    await kv.hdel(ORDERS_KEY, oid);
  } else {
    delete global._asteriaOrders[oid];
  }
}

async function getOrder(oid) {
  if (HAS_KV) {
    const raw = await kv.hget(ORDERS_KEY, oid);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return global._asteriaOrders[oid] || null;
}

async function applyEvent(action, room, oid, payload) {
  if (!oid) return;

  if (action === 'delete') {
    await deleteOrderKV(oid);
  } else if (action === 'create') {
    await setOrder(oid, payload);
  } else {
    const existing = await getOrder(oid);
    const merged = Object.assign({}, existing || { id: oid, room }, payload);
    await setOrder(oid, merged);
  }

  return await bumpSeq();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const [orders, seq] = await Promise.all([getAllOrders(), getSeq()]);

      const normalized = {};
      for (const [oid, val] of Object.entries(orders)) {
        normalized[oid] = typeof val === 'string' ? JSON.parse(val) : val;
      }

      res.status(200).json({ seq, orders: normalized, storage: HAS_KV ? 'kv' : 'memory' });
      return;
    }

    if (req.method === 'POST') {
      const { action, room, oid, payload } = req.body || {};
      if (!oid) {
        res.status(400).json({ error: 'oid wajib diisi' });
        return;
      }
      const seq = await applyEvent(action, room, oid, payload || {});
      res.status(200).json({ ok: true, seq });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('orders API error:', err);
    res.status(500).json({ error: 'Internal error', detail: String(err && err.message || err) });
  }
}
