# 🇮🇩 wilayah-id — API Batas Administrasi Indonesia

REST API & Webmap interaktif untuk batas administrasi Indonesia: **38 provinsi, 514 kabupaten/kota, 7.266 kecamatan, 83.430 desa/kelurahan**.

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-v5-blue)
![PostGIS](https://img.shields.io/badge/PostGIS-3.5-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

## ✨ Features

- **REST API** — 20 endpoints untuk query wilayah, kode pos, batas (GeoJSON), reverse geocode
- **Vector Tiles** — 4 layer MVT (.pbf) via Tippecanoe, served statik dari Vercel CDN
- **Webmap Interaktif** — MapLibre GL JS v5 via [mapcn](https://mapcn.dev), dark/light mode
- **PostGIS** — Full geometry data (MultiPolygon) untuk semua level administrasi
- **Open Source** — Data dari BIG via [batas-administrasi-indonesia](https://github.com/Alf-Anas/batas-administrasi-indonesia)

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

## 📡 API Endpoints

Base URL: `/api/v1`

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
| `kecamatan` | z10–12 | 7.266 |
| `desa` | z12–14 | 83.430 |

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router) |
| Map Engine | MapLibre GL JS v5 |
| Map UI | [mapcn](https://mapcn.dev) (shadcn/ui compatible) |
| Database | PostgreSQL 17 + PostGIS 3.5 (Neon) |
| Tile Generation | Tippecanoe + mb-util |
| ETL | Python 3.11 + GeoPandas |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Deployment | Vercel |

## 📊 Data Sources

| Dataset | Source | Records |
|---------|--------|---------|
| Admin boundaries (SHP) | [BIG via batas-administrasi-indonesia](https://github.com/Olfrfrfr/batas-administrasi-indonesia) | 38 + 514 + 7.266 + 83.430 |
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
