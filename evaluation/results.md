# Evaluasi BFS vs Dijkstra

Peta: 52×36 petak, 1436 node bisa dilewati, 5058 sisi berarah. 2000 pasangan acak (seed 2027); waktu adalah rata-rata 5 kali jalan per pasangan, Node.js v24.12.0.

## Kebenaran

- Semua 2000 rute dari kedua algoritma adalah jalan yang sah (petak bersebelahan, bisa dilewati, berakhir di tujuan), dan biaya yang dilaporkan sama dengan biaya jalurnya.
- Di semua pasangan, biaya Dijkstra ≤ biaya BFS dan langkah BFS ≤ langkah Dijkstra.
- 300 pasangan pertama dicocokkan dengan Bellman-Ford: BFS selalu menemukan jumlah langkah paling sedikit, Dijkstra selalu menemukan biaya paling rendah.

## Ringkasan

| Algoritma | Rata-rata langkah | Rata-rata biaya | Rata-rata node dikunjungi | Rata-rata waktu (µs) |
| --- | ---: | ---: | ---: | ---: |
| BFS | 34.5 | 48.6 | 681.8 | 200.78 |
| Dijkstra | 35.6 | 38.5 | 716.3 | 527.10 |

- Dijkstra menemukan rute yang lebih murah di 1083 dari 2000 pasangan (54.1%); di sisanya biayanya sama.
- Pada pasangan itu, biaya turun rata-rata 28.1% dan paling banyak 73.7%.
- Harga yang dibayar: rute Dijkstra lebih panjang (dalam langkah) di 467 pasangan (23.4%), dan rata-rata waktunya 2.6× BFS.

## Menurut panjang rute (langkah BFS)

| Panjang | Pasangan | Biaya BFS | Biaya Dijkstra | Node BFS | Node Dijkstra | µs BFS | µs Dijkstra |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1–10 | 171 | 11.3 | 8.7 | 53.6 | 67.8 | 26.21 | 70.32 |
| 11–20 | 287 | 24.7 | 19.3 | 230.6 | 284.0 | 75.18 | 219.58 |
| 21–40 | 787 | 43.8 | 34.9 | 639.5 | 685.2 | 187.82 | 502.70 |
| 41+ | 755 | 71.0 | 56.2 | 1039.7 | 1059.9 | 301.56 | 772.90 |
