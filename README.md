# 🇮🇩 wilayah-id — API Batas Administrasi Indonesia

REST API & Webmap interaktif untuk batas administrasi Indonesia: **38 provinsi, 514 kabupaten/kota, 7.285 kecamatan, 83.762 desa/kelurahan**.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-v5-blue)
![PostGIS](https://img.shields.io/badge/PostGIS-3.5-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

## ✨ Features

- **REST API** — 22 endpoints untuk query wilayah, kode pos, batas (GeoJSON), reverse geocode, OGC WMS/WFS
- **Vector Tiles** — 4 layer MVT (.pbf) via Tippecanoe, served statik dari homeserver origin di belakang Cloudflare
- **Webmap Interaktif** — MapLibre GL JS v5 via [mapcn](https://mapcn.dev), dark/light mode
- **OGC Compliant** — WMS 1.3.0 (GetCapabilities, GetMap, GetFeatureInfo) + WFS 2.0 (GetFeature, DescribeFeatureType)
- **MCP Server** — Integrasi langsung dengan Claude Desktop / Cursor Server via Model Context Protocol (FastMCP)
- **PostGIS** — Full geometry data (MultiPolygon) untuk semua level administrasi
- **Open Source** — Data Batas Administrasi dari [Ditjen Dukcapil Kemendagri (2024)](https://gis.dukcapil.kemendagri.go.id/peta/)

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/dhanyyudi/wilayah-id.git
cd id-region-restapi

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env.local
# Edit .env.local with your Neon PostgreSQL DATABASE_URL

# Run ETL (requires Python 3.11+)
python -m venv etl-venv && source etl-venv/bin/activate
pip install geopandas psycopg2-binary python-dotenv tqdm pyogrio shapely
python etl/import_all.py

# Generate vector tiles (requires tippecanoe + mb-util)
python etl/generate_tiles.py

# Start dev server
pnpm dev
```

## ✅ Web verification and health

The web health endpoint is `GET /api/health`. A healthy process returns HTTP
200, a JSON body whose `status` value is `ok`, and a `Cache-Control` header
containing `no-store`.

Run the complete web release gate before publishing a container:

```bash
(
  set -euo pipefail

  image_name="wilayah-id:phase-1"
  container_name="wilayah-id-phase-1-health-$BASHPID"
  health_port=$((20000 + BASHPID % 20000))
  health_headers="$(mktemp)"

  if docker container inspect "${container_name}" >/dev/null 2>&1; then
    printf 'Refusing to replace existing container %s\n' \
      "${container_name}" >&2
    exit 1
  fi

  cleanup() {
    docker rm -f "${container_name}" >/dev/null 2>&1 || true
    rm -f "${health_headers}"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  pnpm install --frozen-lockfile
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm verify:runtime
  pnpm build:cf
  pnpm exec wrangler deploy --dry-run
  docker build --tag "${image_name}" .
  docker run --rm -d \
    --name "${container_name}" \
    -p "127.0.0.1:${health_port}:3000" \
    "${image_name}"

  health_json=""
  health_status=""
  for attempt in $(seq 1 30); do
    if health_json=$(curl \
      --connect-timeout 1 \
      --max-time 2 \
      --dump-header "${health_headers}" \
      --fail --silent --show-error \
      "http://127.0.0.1:${health_port}/api/health" 2>/dev/null); then
      if health_status=$(printf '%s' "${health_json}" | node -p \
        'JSON.parse(require("fs").readFileSync(0, "utf8")).status') && \
        test "${health_status}" = "ok" && \
        grep -qi '^cache-control:.*no-store' "${health_headers}"; then
        break
      fi
    fi

    if test "${attempt}" -eq 30; then
      docker logs "${container_name}" || true
      exit 1
    fi
    sleep 1
  done

  printf 'health_port=%s health=%s\n' "${health_port}" "${health_json}"
  test "${health_status}" = "ok"
  grep -qi '^cache-control:.*no-store' "${health_headers}"
)
```

Each loopback request has a one-second connection timeout and a two-second
total timeout. With 30 attempts and one-second intervals, the health-probe phase
has a wall-clock bound of less than 90 seconds. The subshell keeps fail-fast
options, variables, functions, and traps isolated from the caller.

The Wrangler command validates the Cloudflare bundle only. Cloudflare Worker
deployment is handled separately by Workers Builds and is not performed by
GitHub Actions.

## 📡 API Endpoints

Regional and OGC API base URL: `/api/v1`. The health endpoint remains
`/api/health`.

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Process health and dependency-independent liveness |

### Regions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/regions/provinces` | List 38 provinsi |
| GET | `/regions/provinces/:kode` | Detail provinsi |
| GET | `/regions/regencies?province_code=` | List kabupaten by provinsi |
| GET | `/regions/regencies/:kode` | Detail kabupaten |
| GET | `/regions/districts?regency_code=` | List kecamatan by kabupaten |
| GET | `/regions/districts/:kode` | Detail kecamatan |
| GET | `/regions/villages?district_code=` | List desa by kecamatan |
| GET | `/regions/villages/:kode` | Detail desa + hierarki lengkap |
| GET | `/regions/search?q=&level=` | Cari wilayah multi-level |

### Postal Codes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/postal-codes?village_code=\|postal_code=\|district_code=` | Query kode pos |
| GET | `/postal-codes/lookup?q=` | Lookup prefix kode pos |

### Boundaries (GeoJSON)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/boundaries/provinces?geometry=true` | Batas provinsi + GeoJSON |
| GET | `/boundaries/provinces/:kode?geometry=true` | Single provinsi + geometry |
| GET | `/boundaries/regencies?province_code=&geometry=true` | Batas kabupaten |
| GET | `/boundaries/regencies/:kode?geometry=true` | Single kabupaten |
| GET | `/boundaries/districts?regency_code=&geometry=true` | Batas kecamatan |
| GET | `/boundaries/districts/:kode?geometry=true` | Single kecamatan |
| GET | `/boundaries/villages?district_code=&geometry=true` | Batas desa |
| GET | `/boundaries/villages/:kode?geometry=true` | Single desa |

### Reverse Geocode

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/boundaries/reverse?lat=&lng=&level=` | Koordinat → wilayah |

### OGC Services

Empat koleksi tetap tersedia di semua protokol OGC: `provinces`,
`regencies`, `districts`, dan `villages`.

#### OGC API Features (Core + GeoJSON)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ogc/features` | Landing page (JSON, atau HTML dengan `f=html`) |
| GET | `/ogc/features/conformance` | Deklarasi conformance classes |
| GET | `/ogc/features/api` | Dokumen OpenAPI 3.0 |
| GET | `/ogc/features/collections` | Daftar 4 koleksi |
| GET | `/ogc/features/collections/:collectionId` | Metadata satu koleksi |
| GET | `/ogc/features/collections/:collectionId/items` | FeatureCollection terbatas |
| GET | `/ogc/features/collections/:collectionId/items/:featureId` | Satu fitur |

Parameter `items`: `bbox` (CRS84: minLon,minLat,maxLon,maxLat), `limit`
(default 10, maksimum 1.000), `offset`, `properties`, `crs` (hanya CRS84),
dan `f` (`json`, `geojson`, `html`). Geometri selalu disajikan dalam CRS84
(lon, lat).

#### WFS 2.0

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ogc/wfs?SERVICE=WFS&REQUEST=GetCapabilities` | WFS 2.0 Capabilities XML |
| GET | `/ogc/wfs?SERVICE=WFS&REQUEST=GetFeature&...` | Fitur sebagai GeoJSON atau GML 3.2 |
| GET | `/ogc/wfs?SERVICE=WFS&REQUEST=DescribeFeatureType&...` | Skema XML per tipe fitur |

`GetFeature` menerima `TYPENAMES` (satu tipe per panggilan), `COUNT` /
`STARTINDEX` (batas sama: default 10, maksimum 1.000), `BBOX`,
`SRSNAME` (hanya CRS84 / EPSG:4326), dan `OUTPUTFORMAT`
(`application/geo+json` atau `application/gml+xml; version=3.2`).

#### WMS 1.3.0

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ogc/wms?SERVICE=WMS&REQUEST=GetCapabilities` | WMS 1.3.0 Capabilities XML |
| GET | `/ogc/wms?SERVICE=WMS&REQUEST=GetMap&...` | Render peta raster (PNG/JPEG) |
| GET | `/ogc/wms?SERVICE=WMS&REQUEST=GetFeatureInfo&...` | Info fitur pada piksel (I/J) |

`GetMap` me-render gambar sungguhan dari PostGIS (bukan placeholder) dengan
`FORMAT=image/png` atau `image/jpeg`, maksimum 2.048×2.048 piksel
(4.194.304 piksel total). Urutan sumbu mengikuti WMS 1.3.0: `CRS:84`
memakai lon,lat sedangkan `EPSG:4326` memakai lat,lon. `GetFeatureInfo`
memakai indeks piksel `I`/`J` dan predikat `ST_Covers`, sehingga titik yang
tepat di batas poligon tetap dihitung.

#### Perilaku truthful dan bounded

Semua layanan OGC menolak parameter yang tidak didukung dengan exception
sesuai standar (`ows:ExceptionReport` untuk WFS, `ServiceExceptionReport`
untuk WMS, dokumen exception JSON untuk OGC API Features) — tidak ada
parameter yang diam-diam diabaikan. Khususnya:

- `FILTER` (WFS) ditolak dengan `OperationNotSupported` sampai tata bahasa
  filter yang aman tersedia.
- `datetime` ditolak dengan `InvalidParameterValue` karena data tidak
  memiliki field temporal.
- `STYLES` selain style `default` ditolak dengan `StyleNotDefined`; layer
  yang tidak dikenal ditolak dengan `LayerNotDefined`.
- Kesalahan database tidak pernah bocor ke klien; klien menerima
  `NoApplicableCode` generik.

Smoke check publik untuk seluruh layanan tersedia di
`scripts/smoke-public-geospatial.sh`:

```bash
BASE_URL=http://127.0.0.1:3000 bash scripts/smoke-public-geospatial.sh
```

Perhatian saat menjalankan smoke terhadap server lokal: middleware me-rewrite
setiap permintaan `/api/*` ke `WILAYAH_API_ORIGIN` yang default-nya menunjuk
ke origin API produksi, sehingga smoke bisa diam-diam menguji produksi dan
melaporkan hasil hijau palsu. Untuk target lokal, jalankan server dengan
origin yang menunjuk ke dirinya sendiri (origin HTTP/non-HTTPS ditolak pada
`NODE_ENV=production`, jadi gunakan `pnpm dev`):

```bash
WILAYAH_API_ORIGIN=http://127.0.0.1:3000 \
WILAYAH_TILES_ORIGIN=http://127.0.0.1:3000 \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
DATABASE_URL=... pnpm dev -p 3000
```

Tanda bahwa request di-rewrite ke produksi: header respons memuat
`x-middleware-rewrite: https://wilayah-id-api...` dan `server: openresty`.
Override tidak diperlukan bila `BASE_URL` menunjuk ke deployment sungguhan.

### Response Format

```json
{
  "status": "success",
  "data": { ... },
  "meta": {
    "total": 38,
    "source": "region-id v1.0.1 (lokabisa-oss)"
  }
}
```

## 🗺️ Vector Tiles

4 layer MVT tersedia di `/tiles/{layer}/{z}/{x}/{y}.pbf`:

| Layer | Zoom Range | Features |
|-------|-----------|----------|
| `provinsi` | z3–9 | 38 |
| `kabupaten` | z7–11 | 514 |
| `kecamatan` | z10–12 | 7.285 |
| `desa` | z12–14 | 83.762 |

## 🤖 Model Context Protocol (MCP)

Wilayah-ID menyediakan MCP server yang dapat dihubungkan ke agent berbasis LLM.
Tujuh tool utama memakai kosakata spasial generik; nama tabel dan struktur
administrasi Indonesia disembunyikan di belakang adapter PostGIS read-only.
FastMCP hanya menjadi adapter transport, sedangkan validasi, provenance, dan
semantik operasi berada di module yang dapat diuji.

**Tool interoperabilitas spasial (v1):**

- `describe_spatial_service`: menemukan dataset, layer, atribut, operasi,
  snapshot, lisensi, dan limit;
- `resolve_spatial_entity`: memetakan nama atau kode ke kandidat `FeatureRef`
  yang terurut dan menandai ambiguitas;
- `get_spatial_entity`: mengambil atribut, hierarki, bbox, representative point,
  dan geometri opsional;
- `locate_coordinates`: mencari feature yang mencakup koordinat dengan kebijakan
  `covers` atau `strict_contains`;
- `relate_spatial_entities`: menghitung topology, DE-9IM, jarak meter, dan arah
  antara dua feature;
- `find_related_spatial_entities`: mencari parent, children, neighbors, within,
  contains, intersects, atau nearest;
- `extract_spatial_subset`: menyeleksi atau memotong feature berdasarkan bbox,
  GeoJSON, atau `FeatureRef`, kemudian menghasilkan artefak GeoJSON/GeoPackage.

Lima tool lama—`search_regions`, `get_region_details`, `reverse_geocode`,
`get_top_populated_regions`, dan `get_demographic_summary`—tetap tersedia sebagai
compatibility wrappers. Tool tersebut bukan kontrak generik untuk adapter baru.

Tool generik mengembalikan envelope `status`, `data`, dan `meta`. Metadata
mencakup versi tool, dataset, snapshot, CRS, metode, trace ID, latency,
provenance, serta warnings. Kesalahan memakai kode stabil dan tidak membocorkan
SQL atau detail koneksi.

Semua query memakai connection pool, transaksi read-only, statement timeout
5 detik secara default, dan batas hasil. Geometry entity bersifat opt-in dan
dibatasi berdasarkan jumlah titik. Spatial subset dibatasi maksimal 5.000
feature secara default; artefak disimpan sementara selama 15 menit, memiliki
checksum SHA-256, dibatasi 50 MiB, dan diunduh melalui
`/artifacts/{artifact_id}/{filename}`. GeoJSON AOI dibatasi 1 MiB.

Konfigurasi dapat diubah melalui `MCP_DB_POOL_MIN`, `MCP_DB_POOL_MAX`,
`MCP_STATEMENT_TIMEOUT_MS`, `MCP_MAX_GEOMETRY_POINTS`,
`MCP_MAX_SUBSET_FEATURES`, `MCP_ARTIFACT_DIR`,
`MCP_ARTIFACT_TTL_SECONDS`, `MCP_MAX_AOI_BYTES`,
`MCP_MAX_ARTIFACT_BYTES`, dan `MCP_PUBLIC_BASE_URL`. GeoPackage membutuhkan GDAL
`ogr2ogr`, yang sudah disertakan dalam image MCP.

Snapshot eksperimen yang dikunci untuk baseline MCP adalah geometri batas
Dukcapil 2024 Semester 1, kode wilayah turunan Kepmendagri 2025, dan data kode
pos sebagaimana tercantum pada tabel sumber data di bawah. Perbedaan versi
geometri dan kode harus direkonsiliasi saat membangun ground truth.

Untuk menjalankan test kontrak dan service:

```bash
cd mcp
python -m unittest discover -s tests -v
```

Tes adapter PostGIS aktif ketika `TEST_DATABASE_URL` menunjuk ke schema fixture.
CI membuat schema disposable tersebut, menguji kasus ambiguous name, boundary
point, hierarchy, adjacency, distance, invalid geometry, dan clipped subset,
lalu membangun image Docker.

Docker Compose lokal menjalankan Streamable HTTP pada
`http://127.0.0.1:8000/mcp`. Port hanya di-bind ke loopback. Eksekusi langsung
`python mcp/server.py` tetap memakai `stdio` secara default. Konfigurasi runtime
tersedia melalui `MCP_TRANSPORT`, `MCP_HOST`, `MCP_PORT`,
`MCP_ALLOWED_HOSTS`, dan `MCP_ALLOWED_ORIGINS`.

### Cara menghubungkan di Claude Desktop / Cursor:

Gunakan URL Streamable HTTP yang sesuai dengan lingkungan klien. Untuk
pengembangan lokal: `http://127.0.0.1:8000/mcp`. Deployment homeserver dan
gerbang publik dijelaskan di
[`docs/MCP_DEPLOYMENT.md`](docs/MCP_DEPLOYMENT.md). Endpoint publik tidak boleh
diaktifkan tanpa autentikasi atau pembatasan trafik yang sesuai.

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16.1.6 (App Router) |
| Map Engine | MapLibre GL JS v5 |
| Map UI | [mapcn](https://mapcn.dev) (shadcn/ui compatible) |
| Database | PostgreSQL 17 + PostGIS 3.5 (Neon) |
| OGC Services | WMS 1.3.0 + WFS 2.0 |
| Tile Generation | Tippecanoe + mb-util |
| ETL | Python + GeoPandas |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Deployment | Vercel |

## 📊 Data Sources

| Dataset | Source | Records |
|---------|--------|---------|
| Admin boundaries (SHP) | [Ditjen Dukcapil Kemendagri (2024)](https://gis.dukcapil.kemendagri.go.id/peta/) | 38 + 514 + 7.285 + 83.762 |
| Region codes | [region-id](https://github.com/nicnocquee/region-id) (Kepmendagri 2025) | 91.248 |
| Postal codes | [postal-code-id](https://github.com/nicnocquee/postal-code-id) | 77.721 |

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/v1/          # 20 REST API routes
│   │   │   ├── regions/     # Provinces, regencies, districts, villages, search
│   │   │   ├── postal-codes/# Postal code queries
│   │   │   └── boundaries/  # GeoJSON boundaries + reverse geocode
│   │   ├── page.tsx         # Fullscreen webmap (mapcn)
│   │   └── layout.tsx       # ThemeProvider, metadata
│   ├── components/
│   │   ├── map/             # Map components (VectorLayerManager, InfoPanel, etc.)
│   │   └── ui/              # shadcn/ui + mapcn components
│   └── lib/                 # DB connection, validation, API response helpers
├── etl/
│   ├── import_all.py        # SHP → PostGIS ETL
│   └── generate_tiles.py    # PostGIS → MVT tiles
├── public/tiles/            # Generated .pbf tiles (gitignored)
├── vercel.json              # CORS + cache headers
└── data-*/                  # Source data files
```

## 📄 License

MIT
