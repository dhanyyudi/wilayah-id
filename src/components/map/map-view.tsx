"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "@/components/ui/map";
import maplibregl from "maplibre-gl";

/** Color palette for boundary layers */
const LAYER_COLORS = {
  provinsi: { fill: "rgba(59, 130, 246, 0.08)", stroke: "#3b82f6", width: 2 },
  kabupaten: { fill: "rgba(168, 85, 247, 0.06)", stroke: "#a855f7", width: 1.5 },
  kecamatan: { fill: "rgba(34, 197, 94, 0.05)", stroke: "#22c55e", width: 1 },
  desa: { fill: "rgba(251, 191, 36, 0.04)", stroke: "#fbbf24", width: 0.5 },
};

/** Hover highlight color */
const HOVER_COLOR = "rgba(255, 255, 255, 0.2)";

interface VectorLayerManagerProps {
  layerVisibility: Record<string, boolean>;
  onFeatureClick?: (feature: maplibregl.MapGeoJSONFeature, lngLat: maplibregl.LngLat) => void;
  highlightedFeature?: { source: string; id: string } | null;
}

/**
 * Child component that lives inside <Map> and uses the useMap() hook
 * to add vector tile sources/layers, manage visibility, and handle interactions.
 */
export default function VectorLayerManager({ layerVisibility, onFeatureClick, highlightedFeature }: VectorLayerManagerProps) {
  const { map, isLoaded } = useMap();
  const hoveredFeatureRef = useRef<{ source: string; id: number | string | undefined } | null>(null);
  const tooltipRef = useRef<maplibregl.Popup | null>(null);
  const layersAddedRef = useRef(false);
  const visibilityRef = useRef(layerVisibility);

  // Keep ref in sync with prop
  visibilityRef.current = layerVisibility;

  const tilesBaseUrl = typeof window !== "undefined" ? `${window.location.origin}/tiles` : "/tiles";

  // Add sources and layers once map is loaded / style changes
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Disable default scroll zoom — require Ctrl/Cmd + scroll
    map.scrollZoom.disable();

    // Check if sources were wiped
    try {
      if (!map.getSource("provinsi")) {
        addSources(map);
      }
    } catch (e) {
      console.error("Error adding sources:", e);
    }

    // Check if layers were wiped by theme switch (even if source survived)
    try {
      if (!map.getLayer("provinsi-fill")) {
        addLayers(map);
        // Restore visibility
        for (const [layer, visible] of Object.entries(visibilityRef.current)) {
          setLayerVisibility(map, layer, visible);
        }
      }
    } catch (e) {
      console.error("Error adding custom map layers:", e);
    }
  }, [map, isLoaded]); // Re-runs cleanly when isLoaded toggles during theme switch

  // Cooperative scroll gestures: Ctrl/Cmd + scroll = zoom, plain scroll = scroll page
  useEffect(() => {
    if (!map) return;

    map.scrollZoom.disable();

    const canvas = map.getCanvasContainer();
    let overlayTimeout: ReturnType<typeof setTimeout>;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Temporarily enable scroll zoom, do the zoom, then re-disable
        map.scrollZoom.enable();
        setTimeout(() => map.scrollZoom.disable(), 300);
      } else {
        // Show hint overlay
        let overlay = canvas.querySelector(".coop-hint") as HTMLDivElement | null;
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.className = "coop-hint";
          overlay.style.cssText =
            "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);z-index:10;pointer-events:none;transition:opacity 0.3s;";
          overlay.innerHTML =
            '<span style="color:#fff;font-size:14px;font-weight:500;padding:8px 16px;background:rgba(0,0,0,0.7);border-radius:8px;">Gunakan Ctrl + scroll untuk zoom peta</span>';
          canvas.appendChild(overlay);
        }
        overlay.style.opacity = "1";
        clearTimeout(overlayTimeout);
        overlayTimeout = setTimeout(() => {
          if (overlay) overlay.style.opacity = "0";
        }, 1500);
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      clearTimeout(overlayTimeout);
    };
  }, [map, isLoaded]);

  // Update layer visibility
  useEffect(() => {
    if (!map || !isLoaded) return;

    for (const [layer, visible] of Object.entries(layerVisibility)) {
      setLayerVisibility(map, layer, visible);
    }
  }, [map, isLoaded, layerVisibility]);

  // Click handler
  useEffect(() => {
    if (!map || !isLoaded) return;

    const layers = ["desa-fill", "kecamatan-fill", "kabupaten-fill", "provinsi-fill"];

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const existingLayers = layers.filter(l => map.getLayer(l));
      if (existingLayers.length === 0) return;
      const features = map.queryRenderedFeatures(e.point, { layers: existingLayers });
      if (features.length > 0 && onFeatureClick) {
        onFeatureClick(features[0], e.lngLat);
      }
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [map, isLoaded, onFeatureClick]);

  // Hover handler (tooltip)
  useEffect(() => {
    if (!map || !isLoaded) return;

    const layers = ["desa-fill", "kecamatan-fill", "kabupaten-fill", "provinsi-fill"];

    const tooltip = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "wilayah-tooltip",
      offset: 12,
    });
    tooltipRef.current = tooltip;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const existingLayers = layers.filter(l => map.getLayer(l));
      if (existingLayers.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: existingLayers });

      if (features.length > 0) {
        map.getCanvas().style.cursor = "pointer";
        const f = features[0];
        const p = f.properties;

        // Build tooltip text
        let label = "";
        if (p.nama_desa) {
          label = `${p.nama_desa} (${p.tipe_desa || "Desa"})`;
        } else if (p.nama_kecamatan) {
          label = `Kec. ${p.nama_kecamatan}`;
        } else if (p.nama_kabupaten) {
          label = p.nama_kabupaten;
        } else if (p.nama_provinsi) {
          label = p.nama_provinsi;
        }

        tooltip.setLngLat(e.lngLat).setHTML(`<div style="font-size:14px;font-weight:700;padding:2px 4px;">${label}</div>`).addTo(map);

        // Highlight feature via feature-state
        const source = f.source;
        const id = f.id;
        if (hoveredFeatureRef.current && (hoveredFeatureRef.current.source !== source || hoveredFeatureRef.current.id !== id)) {
          map.setFeatureState(
            { source: hoveredFeatureRef.current.source, sourceLayer: hoveredFeatureRef.current.source, id: hoveredFeatureRef.current.id },
            { hover: false }
          );
        }
        if (id !== undefined) {
          map.setFeatureState({ source, sourceLayer: source, id }, { hover: true });
          hoveredFeatureRef.current = { source, id };
        }
      } else {
        map.getCanvas().style.cursor = "";
        tooltip.remove();

        if (hoveredFeatureRef.current) {
          map.setFeatureState(
            { source: hoveredFeatureRef.current.source, sourceLayer: hoveredFeatureRef.current.source, id: hoveredFeatureRef.current.id },
            { hover: false }
          );
          hoveredFeatureRef.current = null;
        }
      }
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      tooltip.remove();
      if (hoveredFeatureRef.current) {
        map.setFeatureState(
          { source: hoveredFeatureRef.current.source, sourceLayer: hoveredFeatureRef.current.source, id: hoveredFeatureRef.current.id },
          { hover: false }
        );
        hoveredFeatureRef.current = null;
      }
    };

    map.on("mousemove", handleMouseMove);
    map.on("mouseleave", handleMouseLeave);

    return () => {
      map.off("mousemove", handleMouseMove);
      map.off("mouseleave", handleMouseLeave);
      tooltip.remove();
    };
  }, [map, isLoaded]);

  // Spatial Search Blinking Neon Highlight
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!highlightedFeature) {
      setBlink(false);
      return;
    }
    const interval = setInterval(() => setBlink((b) => !b), 500);
    return () => clearInterval(interval);
  }, [highlightedFeature]);

  // Apply blinking feature-state
  const prevHighlightRef = useRef(highlightedFeature);
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Clear old highlighted feature state if it changed
    const prev = prevHighlightRef.current;
    if (prev && (
      !highlightedFeature ||
      prev.source !== highlightedFeature.source ||
      prev.id !== highlightedFeature.id
    )) {
      try {
        map.setFeatureState(
          { source: prev.source, sourceLayer: prev.source, id: prev.id },
          { selected: false }
        );
      } catch { /* source may not exist yet */ }
    }
    prevHighlightRef.current = highlightedFeature ?? undefined;

    if (highlightedFeature) {
      try {
        map.setFeatureState(
          { source: highlightedFeature.source, sourceLayer: highlightedFeature.source, id: highlightedFeature.id },
          { selected: blink }
        );
      } catch { /* source may not exist yet */ }
    }
  }, [map, isLoaded, highlightedFeature, blink]);

  // --- helpers ---

  function addSources(m: maplibregl.Map) {
    if (m.getSource("provinsi")) return; // Already added

    // Indonesia bounding box: [west, south, east, north]
    const idBounds: [number, number, number, number] = [94.5, -11.5, 141.5, 6.5];

    m.addSource("provinsi", {
      type: "vector",
      tiles: [`${tilesBaseUrl}/provinsi/{z}/{x}/{y}.pbf`],
      minzoom: 3,
      maxzoom: 9,
      bounds: idBounds,
      promoteId: "kode_prov",
    });
    m.addSource("kabupaten", {
      type: "vector",
      tiles: [`${tilesBaseUrl}/kabupaten/{z}/{x}/{y}.pbf`],
      minzoom: 7,
      maxzoom: 11,
      bounds: idBounds,
      promoteId: "kode_kab",
    });
    m.addSource("kecamatan", {
      type: "vector",
      tiles: [`${tilesBaseUrl}/kecamatan/{z}/{x}/{y}.pbf`],
      minzoom: 10,
      maxzoom: 12,
      bounds: idBounds,
      promoteId: "kode_kec",
    });
    m.addSource("desa", {
      type: "vector",
      tiles: [`${tilesBaseUrl}/desa/{z}/{x}/{y}.pbf`],
      minzoom: 12,
      maxzoom: 14,
      bounds: idBounds,
      promoteId: "kode_desa",
    });
  }

  function addLayers(m: maplibregl.Map) {
    if (m.getLayer("provinsi-fill")) return; // Already added

    // Provinsi
    m.addLayer({
      id: "provinsi-fill",
      type: "fill",
      source: "provinsi",
      "source-layer": "provinsi",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "rgba(45, 212, 191, 0.4)", // Neon Cyan Blinking
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          LAYER_COLORS.provinsi.fill,
        ],
      },
    });
    m.addLayer({
      id: "provinsi-line",
      type: "line",
      source: "provinsi",
      "source-layer": "provinsi",
      paint: { "line-color": LAYER_COLORS.provinsi.stroke, "line-width": LAYER_COLORS.provinsi.width },
    });

    // Kabupaten
    m.addLayer({
      id: "kabupaten-fill",
      type: "fill",
      source: "kabupaten",
      "source-layer": "kabupaten",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "rgba(45, 212, 191, 0.4)", // Neon Cyan Blinking
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          LAYER_COLORS.kabupaten.fill,
        ],
      },
    });
    m.addLayer({
      id: "kabupaten-line",
      type: "line",
      source: "kabupaten",
      "source-layer": "kabupaten",
      paint: { "line-color": LAYER_COLORS.kabupaten.stroke, "line-width": LAYER_COLORS.kabupaten.width },
    });

    // Kecamatan
    m.addLayer({
      id: "kecamatan-fill",
      type: "fill",
      source: "kecamatan",
      "source-layer": "kecamatan",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "rgba(45, 212, 191, 0.4)", // Neon Cyan Blinking
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          LAYER_COLORS.kecamatan.fill,
        ],
      },
    });
    m.addLayer({
      id: "kecamatan-line",
      type: "line",
      source: "kecamatan",
      "source-layer": "kecamatan",
      paint: { "line-color": LAYER_COLORS.kecamatan.stroke, "line-width": LAYER_COLORS.kecamatan.width },
    });

    // Desa
    m.addLayer({
      id: "desa-fill",
      type: "fill",
      source: "desa",
      "source-layer": "desa",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "rgba(45, 212, 191, 0.4)", // Neon Cyan Blinking
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          LAYER_COLORS.desa.fill,
        ],
      },
    });
    m.addLayer({
      id: "desa-line",
      type: "line",
      source: "desa",
      "source-layer": "desa",
      paint: { "line-color": LAYER_COLORS.desa.stroke, "line-width": LAYER_COLORS.desa.width },
    });
  }

  function setLayerVisibility(m: maplibregl.Map, layer: string, visible: boolean) {
    const val = visible ? "visible" : "none";
    if (m.getLayer(`${layer}-fill`)) m.setLayoutProperty(`${layer}-fill`, "visibility", val);
    if (m.getLayer(`${layer}-line`)) m.setLayoutProperty(`${layer}-line`, "visibility", val);
  }

  // This component renders nothing — it only manages map state via hooks
  return null;
}
