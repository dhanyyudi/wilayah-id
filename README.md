# wilayah-id

API dan webmap batas administrasi Indonesia: **38 provinsi, 514 kabupaten/kota,
7.282 kecamatan, 83.529 desa/kelurahan**, lengkap dengan geometri, kode
Kemendagri, kode pos, dan data penduduk. Tersedia sebagai REST, OGC (API
Features, WFS, WMS), vector tiles, dan server MCP untuk agent LLM.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-v5-blue)
![PostGIS](https://img.shields.io/badge/PostGIS-3.5-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

## Layanan publik

| Layanan | URL | Akses |
|---------|-----|-------|
| Webmap dan dokumentasi | https://wilayah-id-web.gislabs.workers.dev | Anonim |
| REST dan OGC API | `https://wilayah-id-api.dhanypedia.com/api/v1` | Anonim, API key opsional |
| Vector tiles | `https://tiles.dhanypedia.com/{layer}/{z}/{x}/{y}.pbf` | Anonim |
| MCP (Streamable HTTP) | `https://wilayah-id-mcp.dhanypedia.com/mcp` | Header `X-API-Key` |

```bash
curl "https://wilayah-id-api.dhanypedia.com/api/v1/regions/provinces?limit=1"
curl "https://wilayah-id-api.dhanypedia.com/api/v1/boundaries/reverse?lat=-6.1754&lng=106.8272"
```

## Data

| Komponen | Sumber | Edisi |
|----------|--------|-------|
| Geometri batas | [Badan Informasi Geospasial (BIG), BATASWILAYAH](https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH) | 2026-06-12 |
| Kode dan nama wilayah | Kepmendagri 2025 via [region-id v1.0.2](https://github.com/lokabisa-oss/region-id/releases/tag/v1.0.2), dengan koreksi di `data-region-id/name-corrections.csv` | 2025 |
| Penduduk, KK, kepadatan, luas resmi | [Ditjen Dukcapil Kemendagri](https://gis.dukcapil.kemendagri.go.id/peta/) | 2024 Semester 1 |
| Kode pos | [postal-code-id](https://github.com/nicnocquee/postal-code-id) | |

- Desa dan kecamatan memakai layer BIG skala 1:10.000. Kab/kota dibentuk dari
  gabungan kecamatan, dan provinsi dari gabungan kab/kota, sehingga setiap
  level pas di dalam level di atasnya.
- Setiap desa membawa `status_batas` dari BIG. Sebagian besar berstatus
  **Batas Indikatif**, artinya bukan batas definitif dan tidak bisa menjadi
  dasar hukum.
- Area yang belum masuk wilayah administrasi mana pun disimpan terpisah di
  tabel `area_tidak_terdefinisi`.
- Aturan lengkap, hasil uji, dan cara menjalankan ulang ada di
  [`docs/BIG_2026_MIGRATION.md`](docs/BIG_2026_MIGRATION.md).

## REST API

Base URL `/api/v1`. Respons berbentuk `{ "data": ..., "meta": { "total", "source", "snapshot", "attribution" } }`.

| Endpoint | Isi |
|----------|-----|
| `GET /regions/provinces` | Daftar provinsi |
| `GET /regions/regencies?province_code=` | Kab/kota dalam satu provinsi |
| `GET /regions/districts?regency_code=` | Kecamatan dalam satu kab/kota |
| `GET /regions/villages?district_code=` | Desa/kelurahan dalam satu kecamatan |
| `GET /regions/{level}/{kode}` | Detail satu wilayah beserta hierarkinya |
| `GET /regions/search?q=&level=` | Cari wilayah di semua level |
| `GET /boundaries/{level}?...&geometry=true` | Batas wilayah sebagai GeoJSON |
| `GET /boundaries/{level}/{kode}?geometry=true` | Batas satu wilayah |
| `GET /boundaries/reverse?lat=&lng=&level=` | Koordinat ke wilayah (reverse geocoding) |
| `GET /postal-codes?village_code=\|postal_code=\|district_code=` | Kode pos |
| `GET /postal-codes/lookup?q=` | Cari kode pos berdasarkan awalan |
| `GET /api/health` | Health check (di luar `/api/v1`) |

`{level}` adalah `provinces`, `regencies`, `districts`, atau `villages`.
Respons desa memuat `status_batas` dan `edisi_geometri` (`YYYY-MM-DD`).

## OGC

Koleksi di semua protokol: `provinces`, `regencies`, `districts`, `villages`.

| Protokol | Endpoint | Catatan |
|----------|----------|---------|
| OGC API Features (Core, GeoJSON) | `/ogc/features` | `bbox` CRS84, `limit` (maks 1.000), `offset`, `properties`, `f=json\|geojson\|html` |
| WFS 2.0 | `/ogc/wfs?SERVICE=WFS&REQUEST=GetCapabilities` | `GetFeature` sebagai GeoJSON atau GML 3.2, `DescribeFeatureType` |
| WMS 1.3.0 | `/ogc/wms?SERVICE=WMS&REQUEST=GetCapabilities` | `GetMap` PNG/JPEG maks 2.048×2.048 px, `GetFeatureInfo` |

Parameter yang tidak didukung ditolak dengan exception standar OGC, tidak
diabaikan diam-diam. WFS `FILTER` dan `datetime` belum didukung. Geometri
disajikan dalam CRS84 (lon, lat) dengan 6 desimal.

## API key dan batas pemakaian

API bisa dipakai tanpa key. Key gratis dibuat di halaman
[`/keys`](https://wilayah-id-web.gislabs.workers.dev/keys) tanpa akun, lalu
dikirim lewat header `X-API-Key` atau parameter `api_key`.

| Akses | Umum | Endpoint berat | Harian |
|-------|------|----------------|--------|
| Tanpa key (per IP) | 60/menit | 10/menit | tidak dibatasi |
| Key gratis | 300/menit | 60/menit | 20.000 |
| Key pemilik | 3.000/menit | 3.000/menit | tidak dibatasi |

Yang termasuk endpoint berat: WMS `GetMap`, WFS `GetFeature`, OGC `items`, dan
`geometry=true`. Vector tiles dan health tidak dibatasi. Bila batas terlampaui,
server menjawab 429 dengan `Retry-After`; key yang tidak valid dijawab 401. Key
gratis berlaku 365 hari dan hanya ditampilkan sekali.

## Vector tiles

| Layer | Zoom | Fitur |
|-------|------|-------|
| `provinsi` | 3 sampai 9 | 38 |
| `kabupaten` | 7 sampai 11 | 514 |
| `kecamatan` | 10 sampai 12 | 7.282 |
| `desa` | 12 sampai 14 | 83.529 |

Tile berformat MVT tanpa kompresi, dengan CORS terbuka.

## MCP

Server MCP membuka data ini ke agent LLM (Claude Desktop, Cursor, dan klien
MCP lain) dengan kosakata spasial generik. Semua akses bersifat read-only, dan
nama tabel tidak terlihat oleh klien.

| Tool | Fungsi |
|------|--------|
| `describe_spatial_service` | Dataset, layer, atribut, operasi, snapshot, dan batas pemakaian |
| `resolve_spatial_entity` | Nama atau kode ke kandidat wilayah, dengan penanda ambigu |
| `get_spatial_entity` | Atribut, hierarki, bbox, dan geometri (opsional) |
| `locate_coordinates` | Wilayah yang memuat suatu koordinat |
| `relate_spatial_entities` | Topologi, jarak, dan arah antara dua wilayah |
| `find_related_spatial_entities` | Parent, children, tetangga, within, nearest |
| `extract_spatial_subset` | Potong wilayah per bbox, GeoJSON, atau wilayah, lalu unduh GeoJSON/GeoPackage |

Ada juga lima tool lama untuk kompatibilitas (`search_regions`,
`get_region_details`, `reverse_geocode`, `get_top_populated_regions`,
`get_demographic_summary`). Setiap respons memakai envelope `status`, `data`,
`meta` dengan snapshot `big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1`,
CRS, provenance, dan kode error yang stabil.

Endpoint publik butuh key: key gratis dari `/keys` mendapat 120 request dan 10
unduhan artefak per menit. Contoh konfigurasi klien:

```json
{
  "mcpServers": {
    "wilayah-id": {
      "url": "https://wilayah-id-mcp.dhanypedia.com/mcp",
      "headers": { "X-API-Key": "<key dari /keys>" }
    }
  }
}
```

Untuk lokal, jalankan `docker compose up mcp-server` lalu pakai
`http://127.0.0.1:8000/mcp`. Konfigurasi dan deployment ada di
[`docs/MCP_DEPLOYMENT.md`](docs/MCP_DEPLOYMENT.md).

## Menjalankan sendiri

Image web dipublikasikan otomatis ke
`ghcr.io/dhanyyudi/wilayah-id:latest` setiap ada perubahan di `main`.
`docker-compose.yml` menjalankan PostGIS, web, dan MCP sekaligus.

```bash
git clone https://github.com/dhanyyudi/wilayah-id.git
cd wilayah-id
cp .env.example .env.local     # isi DATABASE_URL
pnpm install
pnpm dev                       # http://localhost:3000
```

Database bisa diisi dengan dua cara:

- **Dump release.** Release yang ada sekarang masih memuat data Dukcapil 2024
  dari sebelum migrasi. Dump BIG 2026 akan diterbitkan setelah syarat lisensi
  BIG dipastikan.
- **Bangun sendiri dari BIG.** Ikuti langkah di
  [`docs/BIG_2026_MIGRATION.md`](docs/BIG_2026_MIGRATION.md):
  `etl/big_boundaries.py prepare`, `scripts/load-big-stage.sh`, lalu
  `sql/migrations/20261015_big2026_boundaries.sql`. Tiles dibuat dengan
  `etl/generate_tiles_dukcapil.py` (butuh tippecanoe dan mb-util).

Saat menguji server lokal, set `WILAYAH_RUNTIME_ROLE=origin` supaya `/api/*`
dijawab oleh database lokal. Tanpa itu, request diteruskan ke API publik.

## Pengembangan

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # web
pnpm build:cf && pnpm exec wrangler deploy --dry-run      # bundle Cloudflare
cd mcp && python -m unittest discover -s tests -v          # MCP
python -m unittest discover -s etl/tests -v                # ETL
BASE_URL=http://127.0.0.1:3000 bash scripts/smoke-public-geospatial.sh
```

| Bagian | Teknologi |
|--------|-----------|
| Web | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui |
| Peta | MapLibre GL JS v5 via [mapcn](https://mapcn.dev) |
| Database | PostGIS 3.5 (PostgreSQL 16 di produksi, 17 di compose lokal) |
| MCP | Python 3.11, FastMCP, GDAL untuk GeoPackage |
| ETL | Python, GeoPandas, Shapely 2.1 (`coverage_simplify`) |
| Hosting | Web di Cloudflare Workers (OpenNext); API, tiles, dan MCP di homeserver lewat Cloudflare Tunnel |

```
src/app/            halaman (peta, docs, keys, self-host) dan route API /api/v1
src/lib/            akses database, OGC, validasi, provenance, API key
src/components/     komponen peta dan UI
mcp/                server MCP (FastMCP) dan adapter PostGIS
etl/                persiapan data BIG, nama wilayah, kode pos, tiles
sql/                migrasi dan update data
scripts/            smoke test, staging, dan release data
deploy/             konfigurasi Nginx tiles dan override homeserver
docs/               migrasi BIG 2026 dan deployment MCP
```

## Lisensi

Kode berlisensi MIT. Geometri batas bersumber dari Badan Informasi Geospasial
(BIG) dan tunduk pada ketentuan BIG; cantumkan atribusi BIG saat memakai atau
mendistribusikan ulang geometri. Nama wilayah dari Kepmendagri 2025, data
penduduk dari Ditjen Dukcapil Kemendagri 2024 Semester 1.
