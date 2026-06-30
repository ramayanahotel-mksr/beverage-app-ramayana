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

### ⚠️ PENTING — Perbaikan masalah sinkronisasi (wajib dibaca)

Versi sebelumnya menyimpan data pesanan di **memory sementara**
(`global._asteriaOrders`). Di Vercel, ini **tidak reliable** — setiap
serverless instance bisa berbeda dan instance bisa di-restart kapan
saja, sehingga perubahan dari satu menu (Guest/Staff/Runner/Admin)
kadang tidak terlihat di menu lain, atau data tiba-tiba "hilang".

**Perbaikan yang diterapkan:**
1. **Penyimpanan dipindah ke Vercel KV (Redis)** — satu sumber data
   yang sama dan benar-benar persisten untuk semua menu.
2. **Polling dipercepat** dari 2.5 detik → 1.5 detik, dan otomatis
   "poll cepat" (setiap 0.4 detik, 4x berturut-turut) tepat setelah
   ada perubahan dikirim — supaya menu lain melihat update hampir
   instan, bukan menunggu siklus polling normal.
3. **Bug "perubahan tidak ke-save"** diperbaiki: sebelumnya perubahan
   ditahan di antrean offline selama flag `online` belum dikonfirmasi
   true oleh poll pertama (terjadi sesaat setelah halaman dimuat).
   Sekarang setiap aksi langsung dikirim optimistic ke server; hanya
   masuk antrean jika request benar-benar gagal karena jaringan.
4. **Auto re-sync saat tab kembali aktif** — jika pengguna pindah tab
   lalu balik lagi, aplikasi langsung sinkron ulang alih-alih
   menampilkan data basi.

### Setup Vercel KV (WAJIB untuk production)

1. Buka project di **Vercel Dashboard** → tab **Storage**
2. Klik **Create Database** → pilih **KV**
3. Hubungkan (**Connect**) ke project ini — env var
   `KV_REST_API_URL` dan `KV_REST_API_TOKEN` akan otomatis
   ditambahkan ke project
4. Redeploy project (atau `vercel --prod`)

Tanpa KV, aplikasi tetap berjalan dengan fallback in-memory (cukup
untuk testing cepat), tapi **tidak disarankan untuk pemakaian nyata**
karena data bisa hilang/tidak sinkron seperti masalah sebelumnya.

Cek status penyimpanan yang aktif lewat:
```bash
curl https://nama-project-anda.vercel.app/api/orders
```
Lihat field `"storage"` di response — akan bernilai `"kv"` jika sudah
tersambung dengan benar, atau `"memory"` jika belum (fallback).

---



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
