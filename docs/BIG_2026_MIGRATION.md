# Migrasi Batas Wilayah ke BIG 2026

Status: **rencana dan release candidate**, belum diterapkan ke produksi.
Disusun 2026-10-15; release candidate diuji di database staging yang sama
dengan produksi pada tanggal yang sama.

## Ringkasan keputusan

Geometri batas provinsi, kabupaten/kota, kecamatan, dan desa/kelurahan
diganti dari WebGIS Dukcapil Kemendagri 2024 Semester 1 ke **Badan Informasi
Geospasial (BIG), layanan BATASWILAYAH edisi 2026-06-12**. Yang tidak ikut
diganti:

| Bagian | Sumber setelah migrasi |
|---|---|
| Geometri desa dan kecamatan | BIG BATASWILAYAH 2026-06-12, skala 1:10.000 |
| Geometri kab/kota | gabungan kecamatan BIG per kode kab/kota |
| Geometri provinsi | gabungan kab/kota di atas per kode provinsi |
| Kode wilayah | Kemendagri (kode BIG `KDPKAB`, `KDCPUM`, `KDEPUM` tanpa titik) |
| Nama wilayah | region-id Kepmendagri 2025 yang sudah dikoreksi; nama BIG bila kode tidak ada |
| Data penduduk, KK, kepadatan, luas resmi | tetap Dukcapil 2024 S1, disambung lewat kode |
| Kode pos | tetap, disambung lewat kode desa |

## Mengapa

Perbandingan dibuat dari snapshot BIG yang diunduh utuh dari layanan BATASWILAYAH. Pokoknya:

1. **Asal-usul.** SHP Dukcapil yang dipakai sekarang tidak bisa diunduh ulang
   dari sumber resmi. BIG punya edisi bertanggal dan bisa diunduh ulang secara
   otomatis.
2. **Konsistensi hierarki.** Di BIG, gabungan desa sama dengan kecamatannya
   dan gabungan kecamatan sama dengan kab/kotanya (median selisih luas 0,00%,
   satu kecamatan di atas 5%). Data sekarang: 104 kecamatan dan 23 kab/kota
   di atas 5%.
3. **Atribut baru.** Status batas (Definitif, Hasil Kesepakatan, Indikatif),
   dasar hukum, keterangan delineasi, kode BPS desa.
4. **Kebaruan.** 943 desa dan 44 kecamatan hasil pemekaran yang sudah ada di
   Kepmendagri 2025 belum punya geometri di data sekarang.

## Perbandingan angka

| Level | BIG 2026 (berkode) | wilayah-id sekarang | Kode sama | Hanya BIG | Hanya wilayah-id |
|---|---|---|---|---|---|
| Kab/kota | 514 | 514 | 514 | 0 | 0 |
| Kecamatan | 7.284 | 7.240 | 7.238 | 46 | 2 |
| Desa/kel | 83.529 | 82.802 | 82.586 | 943 | 216 |

Selisih luas per kode yang sama: median 0,04% (kab/kota), 0,15% (kecamatan),
0,30% (desa); 5.916 desa (7%) berbeda lebih dari 20%.

Dari 216 desa yang hanya ada di wilayah-id, 204 masih tercatat di
Kepmendagri 2025 dan 12 berganti kode (nama dan kabupaten sama, kode baru di
BIG). Semua 943 desa yang hanya ada di BIG tercatat di Kepmendagri 2025.

## Aturan transformasi

Diterapkan oleh `etl/big_boundaries.py prepare`.

1. **Kode.** Ambil `KDPKAB`, `KDCPUM`, `KDEPUM`, buang titik, harus 4, 6,
   atau 10 digit. Fitur tanpa kode yang sah (nama "Area Tidak Terdefinisi"
   atau berkode `--`) tidak masuk tabel utama; fitur itu disimpan di layer
   `area_tidak_terdefinisi` bersama keterangannya.
2. **Geometri tidak valid.** `make_valid` (metode `structure`), lalu hanya
   bagian poligon yang disimpan.
3. **Satu kode, banyak fitur.** Digabung menjadi satu MultiPolygon.
4. **Kab/kota dan provinsi dibentuk dari kecamatan.** Layer kab/kota BIG
   berskala 1:50.000 dan 184 dari 514 poligonnya masih edisi 2022 sampai
   2025, sehingga sejumlah pulau di layer kecamatan tidak masuk poligon
   kab/kotanya (misalnya Pulau Pisang, Gunungsitoli Idanoi). Karena itu
   kab/kota = gabungan kecamatan BIG per `kode_kab`, dan provinsi = gabungan
   kab/kota per `kode_prov`. Area tanpa kode di layer kecamatan masuk ke
   kab/kota lewat `KDPKAB` bila kab/kota itu memang punya kecamatan; bila
   tidak, lewat poligon kab/kota BIG yang memuat titik di dalam area itu;
   bila tetap tidak ada, area itu hanya masuk provinsinya lewat `KDPPUM`.
   Layer kab/kota BIG hanya dipakai untuk penempatan itu dan untuk `TIPADM`.
5. **Penyederhanaan.** `coverage_simplify` per level (GEOS 3.12 ke atas),
   sehingga batas bersama dua wilayah tetap berimpit tanpa celah atau
   tumpang tindih. Toleransi sama dengan pipeline sekarang: provinsi 0,001°,
   kab/kota 0,0005°, kecamatan 0,0003°, desa 0,0002°. Area tak terdefinisi
   ikut disederhanakan di coverage yang sama. Kab/kota dan provinsi
   disederhanakan lagi setelah digabung.
6. **Luas.** `area_km2` dihitung ulang secara geodesik di PostGIS
   (`ST_Area(geom::geography)`), sama seperti sekarang. `luas_wilayah`
   (angka resmi Dukcapil) tidak diubah.
7. **Tipe.** `kabupaten.tipe` dari region-id (`regency`/`city`) atau `TIPADM`
   BIG. `desa.tipe` menjadi `DESA` atau `KELURAHAN` dari region-id atau
   `TIPADM` BIG; sekarang semua baris bertipe `DESA`.

## Hasil uji di staging

Database staging berisi data produksi (dump release 2026-03-11 ditambah
koreksi nama 2026-10-15), PostGIS 3.5 pada PostgreSQL 16.

| Pemeriksaan | Data sekarang | Setelah migrasi |
|---|---|---|
| Provinsi / kab/kota / kecamatan / desa | 38 / 514 / 7.240 / 82.802 | 38 / 514 / 7.282 / 83.529 |
| Kecamatan keluar >1% dari kab/kotanya | 178 | 20 (semua pulau kecil, total 5,7 km²) |
| Desa keluar >1% dari kecamatannya | 2.416 | 269 |
| Tumpang tindih >0,01 km² antar kab/kota atau provinsi | | 0 |
| Geometri tidak valid | | 0 |
| Total luas Indonesia | 1.890.706 km² | 1.890.059 km² |
| Titik koordinat desa | 5,8 juta | 11,5 juta |
| Ukuran dump | 109 MB | 217 MB |

Waktu: persiapan 9 menit (puncak memori 19 GB, Mac 16 GB), muat staging
6 detik, migrasi 18 detik, rollback kurang dari 1 detik, restore dump ke
database kosong 4,5 detik. Rollback mengembalikan 82.802 desa, 82.790 kode
pos, dan constraint semula.

Batasan yang diketahui: penyederhanaan kab/kota (0,0005°) dan provinsi
(0,001°) memangkas garis pantai pulau kecil. Bagian kab/kota yang tidak
masuk provinsinya terbesar 7,1 km² (Kepulauan Anambas).

## Perubahan schema

Migrasi `sql/migrations/20261015_big2026_boundaries.sql`, aditif saja:

| Tabel | Kolom baru |
|---|---|
| semua level | `sumber_geometri text`, `edisi_geometri date` |
| `kecamatan`, `desa` | `keterangan_batas text` |
| `desa` | `status_batas varchar(30)`, `dasar_hukum text`, `kode_bps varchar(10)` |
| baru | `area_tidak_terdefinisi` (kode induk, keterangan, geometri) |
| baru | `dataset_snapshot` (satu baris per sumber: nama, edisi, URL, sha256) |

Kolom lama tetap ada, sehingga REST, OGC, dan MCP tidak putus. Kolom baru
diekspos di respons dalam perubahan kode terpisah.

## Desa tanpa geometri BIG

Ada 216 kode desa di data sekarang yang tidak ada di BIG. Kebijakan migrasi:

- 12 kode diganti BIG (nama dan kabupaten sama, kode baru). Kode lama
  dihapus; data penduduk dan kode pos ikut ke kode baru (hanya satu dari
  12 yang punya kode pos).
- 22 kode berada di kecamatan yang sudah tidak ada di BIG (antara lain
  Pamek dan Yuko di Papua Pegunungan) dan dihapus.
- 182 kode sisanya: wilayahnya 99 sampai 100% sudah dicakup desa BIG lain,
  sehingga aturan "pertahankan geometri Dukcapil bila lebih dari 50% tidak
  tertutup BIG" tidak mempertahankan satu pun. Aturan itu tetap ada di
  migrasi untuk snapshot BIG berikutnya.
- 203 baris kode pos milik desa yang dihapus dipindah ke
  `archive_dukcapil2024.postal_code_dropped`; 942 desa baru belum punya kode
  pos.

## Release data

Release GitHub `data-big2026-YYYYMMDD` berisi:

| Berkas | Isi |
|---|---|
| `wilayah_id.dump` | `pg_dump` custom format, compress 9 |
| `wilayah_id.sql.gz` | `pg_dump` plain SQL, gzip |
| `wilayah-id-{provinsi,kabupaten,kecamatan,desa}.parquet` | GeoParquet EPSG:4326, geometri yang sama dengan dump |
| `wilayah-id-boundaries.gpkg` | keempat level dalam satu GeoPackage |
| `manifest.json` | sumber, edisi, sha256 input, parameter, jumlah fitur |
| `report.zip` | laporan perbandingan dan validasi |
| `checksums.txt` | SHA-256 semua berkas |

Release dibuat oleh `scripts/release-data.sh` dari database staging, bukan
dari produksi. Skrip itu tidak mengunggah apa pun; ia mencetak perintah
`gh release create`. Workflow `sql-dump.yml` lama masih membaca Neon, berjalan
bulanan, dan memicu diri pada tag `data-v*`. Karena itu tag release BIG tidak
boleh berawalan `data-v`, dan workflow lama sebaiknya dipensiunkan setelah
release ini terbit.

## Menjalankan ulang persiapan

```bash
uv venv --python 3.12 data-big/.venv
uv pip install --python data-big/.venv/bin/python -r etl/requirements-big.txt

# Snapshot BIG: kabkota/kecamatan/desakel.parquet + manifest.json (lihat bagian Format snapshot)
data-big/.venv/bin/python etl/big_boundaries.py prepare \
  --snapshot data-big/source/big-2026-06-12 \
  --region-id data-region-id \
  --out data-big/prepared

# Database staging yang berisi data wilayah-id sekarang (misalnya dump release terakhir)
DATABASE_URL=postgresql://... scripts/load-big-stage.sh data-big/prepared
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/migrations/20261015_big2026_boundaries.sql

# Aset release
DATABASE_URL=postgresql://... scripts/release-data.sh data-big/release data-big/prepared
```

## Format snapshot

Folder snapshot berisi `kabkota.parquet`, `kecamatan.parquet`, dan
`desakel.parquet` (GeoParquet EPSG:4326, kolom asli BIG: `NAMOBJ`, `REMARK`,
`METADATA`, `KDPPUM`, `KDPKAB`, `KDCPUM`, `KDEPUM`, `KDEBPS`, `UUPP`,
`Status`, `TIPADM`) dari layer `BATAS_KABKOTA_AR`, `BATAS_KECAMATAN_AR`, dan
`BATAS_DESAKEL_AR` di
`https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH`, plus
`manifest.json` dengan `snapshot_id`, `edition`, `source.service_root`, dan
per layer `metadata_values` serta `fetched_count`. Snapshot dipakai untuk
release ini diunduh 2026-10-03 dan berisi 541, 7.432, dan 84.503 fitur.

`data-big/` diabaikan Git. Rollback: `sql/migrations/20261015_big2026_boundaries_rollback.sql`.

## Langkah produksi

1. **Prasyarat.** Koreksi nama region-id sudah masuk `main` (selesai 2026-10-15). Lisensi BIG
   untuk didistribusikan ulang sudah diperiksa. Release candidate sudah
   ditinjau pemilik.
2. **Staging di server.** Muat GeoParquet ke schema `big2026_stage` di
   database produksi tanpa menyentuh `public`.
3. **Validasi di server.** Jumlah fitur, validitas geometri, tidak ada
   tumpang tindih di level yang sama, nesting antar level, kode pos tanpa
   desa, dan contoh reverse geocoding.
4. **Swap dalam satu transaksi.** Pindahkan tabel lama ke schema
   `archive_dukcapil2024`, buat tabel baru di `public` dengan constraint dan
   index yang sama, isi dari staging plus atribut penduduk dari arsip.
5. **Tiles.** Bangun ulang vector tiles dari tabel baru ke direktori baru,
   lalu tukar direktori yang dilayani.
6. **Kode.** Perbarui string sumber dan snapshot di REST, OGC, MCP, halaman
   docs, dan README (`dukcapil-2024-s1` menjadi `big-2026-06-12`).
7. **Uji publik.** Smoke suite 26 cek, MCP acceptance, dan contoh
   reverse geocoding pada titik di desa yang berubah lebih dari 20%.
8. **Rollback.** Kembalikan tabel dari `archive_dukcapil2024` dan direktori
   tiles lama. Arsip disimpan minimal 30 hari.

## Risiko

- 69% desa BIG berstatus **Batas Indikatif**, bukan batas definitif. API
  harus menampilkan status ini.
- Hasil reverse geocoding berubah untuk titik di dekat batas pada sekitar 7%
  desa. Ini perubahan yang terlihat pengguna dan dicatat di catatan rilis.
- Ukuran tiles dan dump bisa naik karena geometri desa BIG lebih rapat
  sebelum disederhanakan.
- Lisensi distribusi ulang data BIG belum diverifikasi. Release publik
  menunggu pemeriksaan ini.
