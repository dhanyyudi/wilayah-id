"""Ephemeral, path-safe artifacts for spatial subset downloads."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from .errors import (
    ArtifactError,
    QueryLimitExceededError,
    SpatialServiceError,
    UnsupportedOperationError,
)

ARTIFACT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
SAFE_LAYER_RE = re.compile(r"[^a-zA-Z0-9_-]+")
FORMAT_CONFIG = {
    "geojson": (".geojson", "application/geo+json"),
    "geopackage": (".gpkg", "application/geopackage+sqlite3"),
}


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime,)):
        return value.isoformat()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")


class ArtifactStore:
    """Creates and resolves temporary artifacts beneath one controlled root."""

    def __init__(
        self,
        root: str | Path | None = None,
        *,
        ttl_seconds: int | None = None,
        max_bytes: int | None = None,
        public_base_url: str | None = None,
        ogr2ogr_command: str | None = None,
    ) -> None:
        self.root = Path(
            root or os.getenv("MCP_ARTIFACT_DIR", "/tmp/wilayah-mcp-artifacts")
        ).resolve()
        self.ttl_seconds = ttl_seconds or int(
            os.getenv("MCP_ARTIFACT_TTL_SECONDS", "900")
        )
        self.max_bytes = (
            max_bytes
            if max_bytes is not None
            else int(os.getenv("MCP_MAX_ARTIFACT_BYTES", "52428800"))
        )
        self.public_base_url = (
            public_base_url
            if public_base_url is not None
            else os.getenv("MCP_PUBLIC_BASE_URL", "")
        ).rstrip("/")
        self.ogr2ogr_command = (
            ogr2ogr_command
            if ogr2ogr_command is not None
            else os.getenv("OGR2OGR_COMMAND", "ogr2ogr")
        )
        self._lock = Lock()

    def create(
        self,
        *,
        layer: str,
        feature_collection: dict[str, Any],
        output_format: str,
        target_crs: str,
    ) -> dict[str, Any]:
        """Write one bounded FeatureCollection and return download metadata."""

        if output_format not in FORMAT_CONFIG:
            raise UnsupportedOperationError(
                "output_format must be geojson or geopackage"
            )
        if output_format == "geojson" and target_crs != "EPSG:4326":
            raise UnsupportedOperationError(
                "GeoJSON artifacts use EPSG:4326; choose geopackage for another CRS"
            )

        with self._lock:
            self._cleanup_expired()
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            artifact_id = uuid4().hex
            artifact_dir = self.root / artifact_id
            artifact_dir.mkdir(mode=0o700)
            safe_layer = SAFE_LAYER_RE.sub("-", layer).strip("-") or "subset"
            suffix, media_type = FORMAT_CONFIG[output_format]
            filename = f"{safe_layer}-subset{suffix}"
            output_path = artifact_dir / filename
            source_path = artifact_dir / f"{safe_layer}-source.geojson"

            try:
                serialized = json.dumps(
                    feature_collection,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    default=_json_default,
                )
                if len(serialized.encode("utf-8")) > self.max_bytes:
                    raise QueryLimitExceededError(
                        "Spatial artifact exceeds the configured byte limit."
                    )
                source_path.write_text(serialized, encoding="utf-8")
                if output_format == "geojson":
                    source_path.replace(output_path)
                else:
                    self._convert_to_geopackage(
                        source_path,
                        output_path,
                        layer=safe_layer,
                        target_crs=target_crs,
                    )
                    source_path.unlink(missing_ok=True)
                if output_path.stat().st_size > self.max_bytes:
                    raise QueryLimitExceededError(
                        "Spatial artifact exceeds the configured byte limit."
                    )

                digest = sha256(output_path.read_bytes()).hexdigest()
                expires_at = datetime.now(timezone.utc) + timedelta(
                    seconds=self.ttl_seconds
                )
                relative_url = f"/artifacts/{artifact_id}/{filename}"
                return {
                    "artifact_id": artifact_id,
                    "filename": filename,
                    "format": output_format,
                    "media_type": media_type,
                    "size_bytes": output_path.stat().st_size,
                    "sha256": digest,
                    "target_crs": target_crs,
                    "expires_at": expires_at.isoformat(),
                    "relative_url": relative_url,
                    "download_url": (
                        f"{self.public_base_url}{relative_url}"
                        if self.public_base_url
                        else None
                    ),
                }
            except SpatialServiceError:
                shutil.rmtree(artifact_dir, ignore_errors=True)
                raise
            except (OSError, subprocess.SubprocessError) as exc:
                shutil.rmtree(artifact_dir, ignore_errors=True)
                raise ArtifactError(str(exc)) from exc

    def resolve(self, artifact_id: str, filename: str) -> Path | None:
        """Resolve only an unexpired artifact with an exact generated name."""

        if not ARTIFACT_ID_RE.fullmatch(artifact_id):
            return None
        if Path(filename).name != filename:
            return None
        with self._lock:
            self._cleanup_expired()
            candidate = (self.root / artifact_id / filename).resolve()
            expected_parent = (self.root / artifact_id).resolve()
            if candidate.parent != expected_parent or not candidate.is_file():
                return None
            return candidate

    def _convert_to_geopackage(
        self,
        source_path: Path,
        output_path: Path,
        *,
        layer: str,
        target_crs: str,
    ) -> None:
        if shutil.which(self.ogr2ogr_command) is None:
            raise UnsupportedOperationError(
                "GeoPackage export is unavailable because ogr2ogr is not installed"
            )
        subprocess.run(
            [
                self.ogr2ogr_command,
                "-f",
                "GPKG",
                str(output_path),
                str(source_path),
                "-nln",
                layer,
                "-t_srs",
                target_crs,
                "-lco",
                "SPATIAL_INDEX=YES",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def _cleanup_expired(self) -> None:
        if not self.root.exists():
            return
        cutoff = datetime.now(timezone.utc).timestamp() - self.ttl_seconds
        for child in self.root.iterdir():
            if (
                child.is_dir()
                and ARTIFACT_ID_RE.fullmatch(child.name)
                and child.stat().st_mtime < cutoff
            ):
                shutil.rmtree(child, ignore_errors=True)
