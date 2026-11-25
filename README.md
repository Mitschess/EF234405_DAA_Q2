# Kelas Virtual ILITS 2027

Kampus 2D tempat peserta jalan-jalan dan ngobrol lewat chat: Lobi, Kelas A, Kelas B, Aula dengan panggung, dan Taman. Tanpa batas 10 orang; batasnya hanya kapasitas server.

## Jalankan

```bash
npm run kelas:install   # sekali
npm run kelas:dev       # http://localhost:5185
```

Mode dev menjalankan tampilan dan server realtime sekaligus (WebSocket di `/ws`). Buka beberapa tab untuk mencoba multipemain, atau `npm --prefix kelas run dev:lan` untuk mencoba dari HP di Wi-Fi yang sama.

## Cara main

- Jalan: tombol panah / WASD, atau ketuk lantai (avatar mencari jalan sendiri).
- Chat: `Enter`, ketik, `Enter` lagi. `Esc` kembali jalan.
  - **Sekitar**: orang dalam radius 6 petak.
  - **Ruangan ini**: semua orang di ruangan yang sama (mis. seluruh Kelas A).
  - **Semua**: semua orang yang online.
- Pesan muncul sebagai gelembung di atas avatar dan di panel chat.

## Uji beban

```bash
npm run kelas:build && npm run kelas:server   # mode produksi di http://localhost:2567
npm run kelas:bots -- 300 60 ws://127.0.0.1:2567/ws   # 300 bot selama 60 detik
```

Hasil di laptop pengembangan (server dan bot di mesin yang sama, ±2/3 bot terus berjalan):

| Pemain | Waktu proses per tick (jatah 100 ms) | Data keluar server | RAM |
| --- | --- | --- | --- |
| 300 | ±9 ms | ±3,7 MB/s | ±67 MB |
| 600 | ±21 ms | ±15 MB/s | ±80 MB |

CPU masih longgar di 600 orang. Yang naik cepat adalah bandwidth, karena setiap orang menerima gerakan semua orang di peta. Untuk lebih dari ±500 orang sekaligus, langkah berikutnya: hanya kirim gerakan orang yang dekat, atau bagi peserta ke beberapa salinan peta (sesi/kanal).

## Deploy ke Railway

Server produksi (`npm start`) melayani halaman **dan** realtime (`/ws`) dari satu alamat, jadi cukup satu service Railway. Server harus **tepat 1 replika**: posisi semua orang disimpan di memori satu proses, jadi kalau ada 2 replika, peserta terpecah dan tidak saling melihat.

Kenapa bukan Vercel: WebSocket di Vercel diputus setiap kali fungsi mencapai durasi maksimum (5 menit di Hobby), dan koneksi bisa tersebar ke beberapa instance.

### Sekali saja

1. Pastikan kode `kelas/` sudah ada di GitHub (branch `feat/kelas-virtual`, atau `master` setelah PR di-merge).
2. Di [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** → pilih repo ini.
3. Buka service-nya → **Settings**, lalu isi:

   | Bagian | Isi |
   | --- | --- |
   | Source → Root Directory | `/kelas` |
   | Source → Branch | branch yang mau dipakai |
   | Source → Watch Paths | `/kelas/**` (supaya perubahan website utama tidak memicu deploy) |
   | Deploy → Custom Start Command | `npm start` |
   | Deploy → Healthcheck Path | `/health` |
   | Deploy → Regions | Southeast Asia (Singapore), **1 replika** |

4. **Variables**:
   - `KELAS_ADMIN_TOKEN`: kode masuk panel admin (lihat [Panel admin](#panel-admin)). Tanpa ini panel admin mati.
   - `MAX_PLAYERS=300` (opsional): batas awal jumlah orang. Bisa diubah lagi dari panel admin.
5. **Settings → Networking → Generate Domain**. Railway memberi alamat seperti `https://kelas-xxxx.up.railway.app`. Buka alamat itu: halaman kelas langsung jalan.

Railway otomatis menjalankan `npm install`, lalu `npm run build` (membuat `dist/`), lalu `npm start`. Pengaturan lewat file `railway.json` tidak dipakai karena Railway menghentikan fitur itu untuk service baru.

### Gladi bersih sebelum acara

Dari laptop, kirim bot ke server yang sudah online:

```bash
npm run kelas:bots -- 150 120 wss://kelas-xxxx.up.railway.app/ws
```

Selama bot jalan, buka halaman di HP dan laptop lain untuk merasakan sendiri. Angka server bisa dilihat di panel admin (`/admin`) atau mentah di `https://kelas-xxxx.up.railway.app/stats`. Bot tidak menyimpan id browser, jadi saat pintu kelas dikunci bot ikut ditolak.

### Saat acara

- **Jangan deploy ulang** saat acara berlangsung. Peserta memang tersambung ulang otomatis ke tempat mereka berdiri, tapi tetap terasa jeda sebentar.
- Kalau internet peserta putus, halaman mencoba menyambung ulang sendiri selama satu menit sebelum menampilkan tombol "Sambung lagi".
- Untuk memasang di domain sendiri (mis. `kelas.domainmu`): **Settings → Networking → Custom Domain**. Website utama cukup memberi tautan ke alamat itu.

### Kebutuhan sumber daya

Uji lokal dengan 150 bot: proses per tick ±4 ms dari jatah 100 ms, RAM ±61 MB, data keluar ±1 MB/s. Untuk 100 orang, perkiraan data keluar ±0,5 MB/s, atau ±3 GB untuk acara 2 jam. Paket terkecil Railway sudah cukup.

### Dibuka lewat website utama (`/kelas`)

`vercel.json` website utama meneruskan `/kelas/*` ke server kelas, jadi peserta cukup membuka `https://<website-utama>/kelas`. Sekarang tujuannya Azure Container Apps (bagian berikut); kalau kembali ke Railway, ganti alamat di aturan `/kelas/` dan `/kelas/:path*` di `vercel.json`. Vercel tidak meneruskan WebSocket. Karena itu server menyisipkan alamatnya sendiri ke halaman (`<meta name="kelas-ws">`), dan koneksi realtime langsung ke server. Alamat itu diambil dari variable `KELAS_PUBLIC_WS_URL=wss://…/ws`, atau di Railway dari `RAILWAY_PUBLIC_DOMAIN` yang disediakan otomatis.

## Deploy ke Azure Container Apps

Tempat kelas berjalan sekarang, memakai kredit Azure for Students. Akun student tidak punya jatah App Service B1, jadi yang dipakai Container Apps. Alamatnya `https://kelas.greendesert-648deda9.malaysiawest.azurecontainerapps.io`. Uji 495 bot selama 2 menit (dijalankan dari dalam Azure): semua bertahan, tick ±9 ms dari jatah 100 ms, RAM ±90 MB, data keluar ±10 MB/s (±36 GB per jam; jatah gratis 100 GB per bulan).

- **Image.** Setiap push ke `master` yang mengubah `kelas/` menjalankan `.github/workflows/kelas-image.yml`, yang mem-build `kelas/Dockerfile` ke `ghcr.io/mitschess/kpkxilits27-kelas` (tag `latest` dan SHA commit). Package itu diset **Public** di GitHub supaya Azure bisa menariknya tanpa kredensial. Isinya hanya kelas yang sudah di-build, tanpa kode admin atau rahasia.
- **Azure.** Resource group `kelas-ilits`, environment `kelas-env` (mode biasa, bukan Express: Express tidak bisa menjalankan job, dan uji 300 bot dari laptop putus di sana), app `kelas` di Malaysia West. Pengaturannya: maksimal **1 replika** (semua peserta harus di server yang sama), 0,5 vCPU / 1 GiB, ingress port 8080, kode admin disimpan sebagai secret `admin-token` (variable `KELAS_ADMIN_TOKEN=secretref:admin-token`), dan `KELAS_PUBLIC_WS_URL=wss://kelas.greendesert-648deda9.malaysiawest.azurecontainerapps.io/ws` wajib diisi supaya `/kelas` lewat Vercel bisa tersambung.
- **Mengganti kode admin:** `az containerapp secret set -g kelas-ilits -n kelas --secrets admin-token=<kode-baru>`, lalu restart revisi aktif (portal: app `kelas` → **Revisions and replicas** → **Restart**) supaya server membacanya.
- **Memasang versi baru** setelah workflow selesai:

  ```powershell
  az containerapp update -g kelas-ilits -n kelas --image ghcr.io/mitschess/kpkxilits27-kelas:<sha-commit>
  ```

- **Hemat vs siap acara.** Di luar acara pakai `--min-replicas 0`: server mati sendiri saat sepi dan hampir gratis, tapi orang pertama menunggu ±10 detik dan hitungan admin mulai dari nol. Beberapa jam sebelum acara, jalankan `az containerapp update -g kelas-ilits -n kelas --min-replicas 1`, lalu kembalikan ke 0 setelah selesai.

## Panel admin

Halaman khusus panitia di `/admin` (lewat website utama: `/kelas/admin`). Isinya:

- **Ringkasan**: yang online sekarang (dan puncaknya), berapa orang berbeda yang pernah masuk, jumlah chat, beban server (Lancar / Mulai berat / Berat), data keluar, RAM.
- **Grafik** orang online dan beban server untuk 15 menit, 1 jam, atau 3 jam terakhir, plus tabel angka per menit.
- **Orang per ruangan** (Kelas A, Aula, Kelas B, Lobi, Taman, Lorong).
- **Kontrol kelas**:
  - *Terbuka*: siapa saja bisa masuk.
  - *Kunci pintu*: yang sudah di dalam tetap (dan bisa tersambung ulang), peserta baru tidak bisa masuk.
  - *Tutup kelas*: semua dikeluarkan dan tidak ada yang bisa masuk sampai dibuka lagi.
  - Kunci chat untuk semua, ubah batas peserta, pasang pengumuman (muncul sebagai spanduk di layar semua peserta).
- **Daftar peserta**: cari nama, *Bisukan* chat seseorang, atau *Keluarkan* (tidak bisa masuk lagi dari browser yang sama selama 15 menit).
- **Aktivitas panitia**: siapa mengubah apa dan kapan.

### Menyalakan

Buat kode acak yang panjang (jangan pakai kata yang mudah ditebak):

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

Isi hasilnya ke Railway → service → **Variables** → `KELAS_ADMIN_TOKEN`, lalu tunggu deploy ulang selesai. Bagikan kode itu hanya ke panitia. Saat membuka `/admin`, masukkan kode itu dan nama kamu (nama dicatat di riwayat aktivitas). Untuk mengganti kode, ubah variable-nya; semua panitia perlu masuk lagi dengan kode baru.

Di mode dev (`npm run kelas:dev`) panel admin ada di `http://localhost:5185/admin` dengan kode `admin-dev`.

Catatan:

- Semua angka disimpan di memori server, jadi mulai dari nol lagi setiap server restart atau deploy ulang.
- "Pernah masuk" dihitung per browser: orang yang sama membuka ulang halaman tetap dihitung satu.
- Setelah 8 kode salah dalam satu menit dari alamat yang sama, percobaan berikutnya ditolak selama satu menit.

## Struktur

- `shared/map.js`: peta, zona ruangan, aturan jalan, dipakai server dan klien.
- `server/game.js`: ruang realtime (validasi langkah, batas kecepatan, chat, siaran per 100 ms) dan kontrol panitia.
- `server/admin.js`: API panel admin (`/admin/api/state`, `/admin/api/action`) dengan kode `KELAS_ADMIN_TOKEN`.
- `src/scene.js`: dunia Phaser (avatar, kamera, jalan, gelembung chat).
- `src/art.js`: semua gambar peta dan avatar dibuat lewat kode, tanpa file gambar.
- `src/main.js`: layar masuk, chat, koneksi, sambung-ulang otomatis, pengumuman.
- `admin.html`, `src/admin.js`: panel admin.
- `server/index.js`: server produksi (halaman dari `dist/`, realtime di `/ws`, `/admin`, `/health`, `/stats`).

## Batas prototipe

- Peserta belum login: nama bebas diisi. Moderasi lewat panel admin (bisukan, keluarkan, kunci chat), tapi orang yang dikeluarkan bisa masuk lagi dari browser lain.
- Chat tidak disimpan; yang baru masuk (atau yang baru tersambung ulang) tidak melihat pesan sebelumnya.
- Satu proses server = satu peta bersama, jadi jalankan tepat 1 replika.
