# EF234405 DAA · Quiz 2: Rute Terpendek di Kampus Virtual

Kampus 2D multipemain (Lobi, Kelas A, Kelas B, Aula, Taman) tempat setiap orang punya avatar. Ketuk sebuah petak, dan avatar mencari jalan ke sana sendiri. Rute dicari dengan dua algoritma dari mata kuliah, yang bisa dipilih dan dibandingkan langsung di layar:

- **BFS** (Breadth-First Search): rute dengan **langkah paling sedikit**.
- **Dijkstra**: rute dengan **biaya paling rendah**, karena setiap jenis petak punya biaya.

## Model graf

Peta berukuran 52×36 petak. Setiap petak yang bisa dilewati adalah sebuah **node** (1.436 node), dan setiap node terhubung ke tetangganya di atas, bawah, kiri dan kanan (5.058 sisi berarah). Bobot sisi menuju sebuah petak adalah biaya petak itu:

| Petak | Biaya |
| --- | ---: |
| Lantai kelas, lobi, karpet aula, jalan setapak taman | 1 |
| Panggung | 2 |
| Rumput | 3 |
| Kursi kelas dan kursi aula | 5 |

Dinding, meja, papan tulis, tanaman, pohon, air mancur dan bangku tidak bisa dilewati. Kalau yang diketuk adalah petak yang menghalangi (misalnya meja), tujuannya menjadi petak di sebelahnya.

## Algoritma

Keduanya ada di [`shared/pathfinding.js`](shared/pathfinding.js), dan masing-masing mengembalikan `{ path, cost, steps, visited, order }`.

| | BFS | Dijkstra |
| --- | --- | --- |
| Yang diminimalkan | jumlah langkah | total biaya petak |
| Struktur data | antrean (array + indeks kepala) | binary min-heap |
| Kompleksitas waktu | O(V + E) | O((V + E) log V) |
| Berhenti saat | tujuan pertama kali ditemukan | tujuan pertama kali diambil dari heap |

BFS mengabaikan bobot, jadi rutenya bisa memotong rumput atau deretan kursi yang mahal. Dijkstra memutar lewat lantai atau jalan setapak bila itu lebih murah, walaupun langkahnya lebih banyak.

## Menjalankan

Butuh Node.js 20 atau lebih baru.

```bash
npm install
npm run dev        # http://127.0.0.1:5185
```

Mode dev menjalankan tampilan dan server realtime sekaligus. Buka beberapa tab untuk mencoba multipemain.

## Cara pakai

1. Isi nama, pilih warna, lalu **Masuk**.
2. Di panel **Rute** (kiri atas), pilih **BFS** atau **Dijkstra**.
3. Ketuk sebuah petak. Avatar berjalan mengikuti rute algoritma yang dipilih, dan:
   - rutenya digambar di peta (kuning untuk BFS, hijau untuk Dijkstra);
   - petak yang dijelajahi algoritma itu muncul sebentar sesuai urutan kunjungannya;
   - panel menampilkan langkah, biaya, jumlah node dikunjungi dan waktu **kedua** algoritma untuk tujuan yang sama.

Tombol panah atau WASD tetap bisa dipakai untuk berjalan manual. `Enter` membuka chat.

## Evaluasi

```bash
npm run eval
```

Skrip [`scripts/evaluate.js`](scripts/evaluate.js) menjalankan kedua algoritma pada 2.000 pasangan titik acak (seed tetap, jadi hasilnya bisa diulang) dan menulis hasilnya ke [`evaluation/results.md`](evaluation/results.md). Skrip ini juga:

- memastikan setiap rute adalah jalan yang sah dan biaya yang dilaporkan sesuai jalurnya;
- memastikan biaya Dijkstra tidak pernah lebih mahal dari BFS, dan langkah BFS tidak pernah lebih banyak dari Dijkstra;
- mencocokkan 300 pasangan dengan **Bellman-Ford** sebagai acuan independen: BFS selalu menemukan langkah paling sedikit, Dijkstra selalu menemukan biaya paling rendah.

Ringkasan hasil terakhir:

| Algoritma | Langkah | Biaya | Node dikunjungi | Waktu (µs) |
| --- | ---: | ---: | ---: | ---: |
| BFS | 34,5 | 48,6 | 681,8 | 200,78 |
| Dijkstra | 35,6 | 38,5 | 716,3 | 527,10 |

Dijkstra menemukan rute lebih murah di 54,1% pasangan, dengan penghematan biaya rata-rata 28,1% (paling banyak 73,7%). Harganya, rutenya lebih panjang dalam langkah di 23,4% pasangan, dan waktunya rata-rata 2,6× BFS. Angka waktu bergantung pada mesin yang menjalankan.

## Struktur

- `shared/map.js`: peta, zona ruangan, aturan petak yang bisa dilewati, dan biaya petak (`COST`, `tileCost`, `pathCost`).
- `shared/pathfinding.js`: BFS, Dijkstra dan min-heap.
- `src/scene.js`: dunia Phaser: avatar, kamera, menjalankan kedua algoritma saat petak diketuk, menggambar rute dan petak yang dijelajahi.
- `src/main.js`: layar masuk, chat, koneksi, dan panel Rute.
- `src/art.js`: semua gambar peta dan avatar dibuat lewat kode.
- `server/game.js`: server realtime (memvalidasi setiap langkah, chat, siaran posisi per 100 ms).
- `server/index.js`: server produksi (`npm run build && npm start`, port 2567).
- `scripts/evaluate.js`: evaluasi BFS vs Dijkstra.
- `scripts/bots.js`: uji beban dengan bot.

## Tim

- [Mitschess](https://github.com/Mitschess)
- [attelarten](https://github.com/attelarten)
- [Distruck-lorem](https://github.com/Distruck-lorem)
