# Asteria Hotel — Beverage Room Service App
## Deployment ke Vercel

### Struktur proyek
```
asteria-hotel/
├── public/
│   └── index.html          ← App utama (Guest + Staff + Runner)
├── api/
│   └── orders.js           ← Serverless API: GET snapshot / POST event
├── server.js               ← Server lokal (Node.js, untuk dev lokal)
├── vercel.json             ← Konfigurasi Vercel
└── package.json
```

### Deploy ke Vercel (3 cara)

#### Cara 1 — Vercel CLI (tercepat)
```bash
npm i -g vercel
cd asteria-hotel
vercel
```
Ikuti prompt, pilih scope/project. URL akan diberikan otomatis.

#### Cara 2 — GitHub + Vercel Dashboard
1. Push folder ini ke GitHub repo
2. Buka https://vercel.com → "New Project"
3. Import repo, biarkan semua setting default
4. Klik **Deploy** — selesai

#### Cara 3 — Drag & Drop
1. Buka https://vercel.com/new
2. Drag folder `asteria-hotel` ke area upload

---

### Menjalankan lokal (dengan WebSocket asli)
```bash
node server.js
# Buka http://localhost:3000
```

### Menjalankan lokal (simulasi Vercel)
```bash
npm i -g vercel
vercel dev
# Buka http://localhost:3000
```

---

### Arsitektur di Vercel

| Komponen | Implementasi |
|---|---|
| Frontend | Static file (`public/index.html`) |
| Realtime sync | HTTP Polling tiap 2.5 detik ke `/api/orders` |
| Penyimpanan | In-memory (`global._asteriaOrders`) |
| State persistence | Bertahan selama instance Vercel hidup |

> **Catatan:** Vercel Serverless tidak mendukung WebSocket persisten.
> Aplikasi menggunakan HTTP polling sebagai pengganti — sinkronisasi
> tetap berjalan otomatis, dengan latency ~2-3 detik antar perangkat.
>
> Untuk persistensi data permanen lintas-deploy, sambungkan
> **Vercel KV** (Upstash Redis):
> ```bash
> vercel env add KV_REST_API_URL
> vercel env add KV_REST_API_TOKEN
> ```
> Lalu ganti `global._asteriaOrders` di `api/orders.js` dengan
> panggilan `@vercel/kv`.

---

### Cara uji sinkronisasi
1. Buka URL Vercel di **dua tab browser** (atau dua perangkat berbeda)
2. Tab 1: pilih **Guest App**, masuk kamar, pesan minuman
3. Tab 2: pilih **Staff Dashboard** — pesanan muncul dalam ~2-3 detik
4. Proses pesanan di Staff → status berubah otomatis di tab Guest
