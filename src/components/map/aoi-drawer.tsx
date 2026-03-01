"use client";

import { useEffect, useRef, useCallback, useContext } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Feature } from "geojson";

// CSS for mapbox-gl-draw
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import { MapContext } from "@/components/ui/map";

interface AOIDrawerProps {
  mode: "rectangle" | "polygon" | null;
  onDrawCreate?: (features: Feature[]) => void;
  onDrawUpdate?: (features: Feature[]) => void;
  onDrawDelete?: () => void;
  clearDraw?: boolean; // Trigger to clear all drawings
}

export default function AOIDrawer({ 
  mode, 
  onDrawCreate, 
  onDrawUpdate,
  onDrawDelete,
  clearDraw 
}: AOIDrawerProps) {
  const mapContext = useContext(MapContext);
  const map = mapContext?.map || null;
  const drawRef = useRef<MapboxDraw | null>(null);
  const isInitialized = useRef(false);

  // Initialize draw control
  useEffect(() => {
    if (!map || isInitialized.current) return;

    // Create draw control
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      defaultMode: "simple_select",
      styles: [
        // Active drawing style
        {
          id: "gl-draw-polygon-fill-active",
          type: "fill",
          filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
          paint: {
            "fill-color": "#3b82f6",
            "fill-outline-color": "#3b82f6",
            "fill-opacity": 0.2,
          },
        },
        {
          id: "gl-draw-polygon-stroke-active",
          type: "line",
          filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
          paint: {
            "line-color": "#3b82f6",
            "line-width": 3,
          },
        },
        // Inactive style
        {
          id: "gl-draw-polygon-fill-inactive",
          type: "fill",
          filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
          paint: {
            "fill-color": "#10b981",
            "fill-outline-color": "#10b981",
            "fill-opacity": 0.2,
          },
        },
        {
          id: "gl-draw-polygon-stroke-inactive",
          type: "line",
          filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
          paint: {
            "line-color": "#10b981",
            "line-width": 2,
          },
        },
        // Vertex points
        {
          id: "gl-draw-polygon-midpoint",
          type: "circle",
          filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
          paint: {
            "circle-radius": 4,
            "circle-color": "#3b82f6",
          },
        },
        {
          id: "gl-draw-polygon-vertex",
          type: "circle",
          filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"]],
          paint: {
            "circle-radius": 6,
            "circle-color": "#fff",
            "circle-stroke-color": "#3b82f6",
            "circle-stroke-width": 2,
          },
        },
      ],
    });

    // Add control to map
    map.addControl(draw as any, "top-left");
    drawRef.current = draw;
    isInitialized.current = true;

    // Add event listeners
    const handleDrawCreate = (e: { features: Feature[] }) => {
      onDrawCreate?.(e.features);
    };

    const handleDrawUpdate = (e: { features: Feature[] }) => {
      onDrawUpdate?.(e.features);
    };

    const handleDrawDelete = () => {
      onDrawDelete?.();
    };

    map.on("draw.create", handleDrawCreate);
    map.on("draw.update", handleDrawUpdate);
    map.on("draw.delete", handleDrawDelete);

    return () => {
      map.off("draw.create", handleDrawCreate);
      map.off("draw.update", handleDrawUpdate);
      map.off("draw.delete", handleDrawDelete);
      try {
        map.removeControl(draw as any);
      } catch {
        // Ignore if already removed
      }
      drawRef.current = null;
      isInitialized.current = false;
    };
  }, [map, onDrawCreate, onDrawUpdate, onDrawDelete]);

  // Handle mode changes
  useEffect(() => {
    if (!drawRef.current || !map) return;

    const draw = drawRef.current;

    if (mode === "rectangle" || mode === "polygon") {
      // Use draw_polygon for both (user can draw rectangle manually)
      // For true rectangle, we'd need a custom mode, but polygon works for now
      draw.changeMode("draw_polygon");
    } else {
      // Simple select mode (no drawing)
      draw.changeMode("simple_select");
    }
  }, [mode, map]);

  // Handle clear draw trigger
  useEffect(() => {
    if (!drawRef.current || !clearDraw) return;
    
    const draw = drawRef.current;
    draw.deleteAll();
  }, [clearDraw]);

  // Expose methods to parent via ref if needed
  return null;
}

// Helper to get bounds from GeoJSON feature
export function getBoundsFromFeature(feature: Feature): maplibregl.LngLatBounds | null {
  if (!feature.geometry) return null;

  const coords: number[][] = [];
  
  if (feature.geometry.type === "Polygon") {
    const poly = feature.geometry.coordinates[0]; // Outer ring
    poly.forEach((coord) => coords.push(coord as number[]));
  } else if (feature.geometry.type === "MultiPolygon") {
    feature.geometry.coordinates.forEach((polygon) => {
      polygon[0].forEach((coord) => coords.push(coord as number[]));
    });
  }

  if (coords.length === 0) return null;

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);

  return new maplibregl.LngLatBounds(
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)]
  );
}
