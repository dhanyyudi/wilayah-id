"""Data sources and snapshot identifier reported by every MCP response.

The values mirror the active rows of ``public.dataset_snapshot`` written by
``sql/migrations/20261015_big2026_boundaries.sql``; update both together when
a new snapshot is loaded. The web application keeps the same values in
``src/lib/provenance.ts``.
"""

from __future__ import annotations

DATASET_SNAPSHOT = "big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1"

GEOMETRY_SOURCE = "Badan Informasi Geospasial (BIG), BATASWILAYAH"
GEOMETRY_EDITION = "2026-06-12"
GEOMETRY_URL = "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH"
NAMES_SOURCE = "Kepmendagri 2025 via region-id"
NAMES_EDITION = "2025"
DEMOGRAPHICS_SOURCE = "Ditjen Dukcapil Kemendagri"
DEMOGRAPHICS_EDITION = "2024-semester-1"

ATTRIBUTION = (
    "Badan Informasi Geospasial (BIG); Kemendagri; Ditjen Dukcapil Kemendagri"
)

DATA_SOURCES = [
    {
        "name": GEOMETRY_SOURCE,
        "snapshot": GEOMETRY_EDITION,
        "role": "geometry",
        "url": GEOMETRY_URL,
    },
    {
        "name": NAMES_SOURCE,
        "snapshot": NAMES_EDITION,
        "role": "identifiers-and-hierarchy",
        "url": "https://github.com/lokabisa-oss/region-id",
    },
    {
        "name": DEMOGRAPHICS_SOURCE,
        "snapshot": DEMOGRAPHICS_EDITION,
        "role": "demographics",
        "url": "https://gis.dukcapil.kemendagri.go.id/peta/",
    },
]
