"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Map, MapControls, MapPopup, type MapRef } from "@/components/ui/map";
import VectorLayerManager from "@/components/map/map-view";
import Navbar from "@/components/map/navbar";
import LayerPanel from "@/components/map/layer-panel";
import InfoPanel from "@/components/map/info-panel";
import MapSearchBar from "@/components/map/search-bar";
import DownloadPanel from "@/components/map/download-panel";
import DownloadByLevel from "@/components/map/download-by-level";
import AOIDrawer, { getBoundsFromFeature } from "@/components/map/aoi-drawer";
import type { Feature } from "geojson";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Globe, Play, MapPin, Search, Copy, X, ChevronDown, Github, Database, AlertTriangle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MapGeoJSONFeature, LngLat } from "maplibre-gl";
import Link from "next/link";
import { TechStackMarquee } from "@/components/tech-stack-marquee";
import { SearchAnimation } from "@/components/search-animation";

/* ── Stats ───────────────────────────────────────── */
// Removed unused STATS array

// Removed API_CATEGORIES constant as we'll use a new structure for the features grid

/* ══════════════════════════════════════════════════ */
export default function HomePage() {
  const mapSectionRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapRef>(null);

  /* ── Map state ─────────────────────────────────── */
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({
    provinsi: true,
    kabupaten: true,
    kecamatan: true,
    desa: true,
  });
  const [selectedFeature, setSelectedFeature] = useState<{
    feature: MapGeoJSONFeature;
    lngLat: LngLat;
  } | null>(null);
  
  /* ── AOI (Area of Interest) state ──────────────── */
  const [aoiMode, setAoiMode] = useState<"rectangle" | "polygon" | null>(null);
  const [aoiBounds, setAoiBounds] = useState<maplibregl.LngLatBounds | null>(null);
  const [aoiFeatures, setAoiFeatures] = useState<Feature[]>([]);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [clearDrawTrigger, setClearDrawTrigger] = useState(false);
  
  /* ── Mobile panel visibility ───────────────────── */
  const [showPanels, setShowPanels] = useState(true);

  const handleCreateAOI = useCallback((mode: "rectangle" | "polygon" | null) => {
    setAoiMode(mode);
    if (!mode) {
      // Clear AOI when mode is null
      setAoiBounds(null);
      setAoiFeatures([]);
    }
  }, []);

  const handleDrawCreate = useCallback((features: Feature[]) => {
    setAoiFeatures(features);
    if (features.length > 0) {
      const bounds = getBoundsFromFeature(features[0]);
      setAoiBounds(bounds);
      // Clear drawing mode after creation
      setAoiMode(null);
    }
  }, []);

  const handleDrawUpdate = useCallback((features: Feature[]) => {
    setAoiFeatures(features);
    if (features.length > 0) {
      const bounds = getBoundsFromFeature(features[0]);
      setAoiBounds(bounds);
    }
  }, []);

  const handleDrawDelete = useCallback(() => {
    setAoiFeatures([]);
    setAoiBounds(null);
    setClearDrawTrigger(true);
    // Reset trigger after short delay
    setTimeout(() => setClearDrawTrigger(false), 100);
  }, []);

  // Get map instance when ready
  useEffect(() => {
    if (mapRef.current) {
      setMapInstance(mapRef.current as unknown as maplibregl.Map);
    }
  }, [mapRef.current]);

  const handleLayerToggle = useCallback((id: string) => {
    setLayerVisibility((p) => ({ ...p, [id]: !p[id] }));
  }, []);
  const handleFeatureClick = useCallback((f: MapGeoJSONFeature, l: LngLat) => {
    // Skip if in AOI drawing mode
    if (aoiMode) return;
    setSelectedFeature({ feature: f, lngLat: l });
  }, [aoiMode]);
  const handleClosePopup = useCallback(() => setSelectedFeature(null), []);

  /* ── Reverse geocode state ─────────────────────── */
  const [reverseResult, setReverseResult] = useState<Record<string, Record<string, string>> | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  const [reverseCoords, setReverseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [highlightedFeature, setHighlightedFeature] = useState<{ source: string; id: string } | null>(null);

  const handleMapRightClick = useCallback(async (e: maplibregl.MapMouseEvent & { originalEvent?: MouseEvent }) => {
    // Only process right-click (button 2)
    if (e.originalEvent?.button !== 2) return;
    
    // Skip if in AOI drawing mode
    if (aoiMode) return;
    
    const { lng, lat } = e.lngLat;
    setReverseLoading(true);
    setReverseCoords({ lat, lng });
    setReverseResult(null);
    setHighlightedFeature(null);
    try {
      const res = await fetch(`/api/v1/boundaries/reverse?lat=${lat}&lng=${lng}`);
      const json = await res.json();
      if (json.data) {
        setReverseResult(json.data);
        const d = json.data;
        if (d.desa?.kode_desa) setHighlightedFeature({ source: "desa", id: d.desa.kode_desa });
        else if (d.kecamatan?.kode_kec) setHighlightedFeature({ source: "kecamatan", id: d.kecamatan.kode_kec });
        else if (d.kabupaten?.kode_kab) setHighlightedFeature({ source: "kabupaten", id: d.kabupaten.kode_kab });
        else if (d.provinsi?.kode_prov) setHighlightedFeature({ source: "provinsi", id: d.provinsi.kode_prov });
      }
    } catch { /* ignore */ } finally {
      setReverseLoading(false);
    }
  }, [aoiMode]);
  const apiExplorerRef = useRef<HTMLDivElement>(null);
  const scrollToExplorer = () => {
    apiExplorerRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /* ── API Explorer state ────────────────────────── */
  const [selectedEndpoint, setSelectedEndpoint] = useState("/regions/provinces");
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  const runApiCall = async () => {
    setApiLoading(true);
    setApiResult(null);
    try {
      const res = await fetch(`/api/v1${selectedEndpoint}`);
      const json = await res.json();
      setApiResult(JSON.stringify(json, null, 2));
    } catch {
      setApiResult('{"error": "Request failed"}');
    } finally {
      setApiLoading(false);
    }
  };

  const scrollToMap = () => {
    mapSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSearchResult = useCallback((result: any) => {
    if (result.lng && result.lat && mapRef.current) {
      const map = mapRef.current;
      
      // Determine zoom level based on region level
      let zoomLevel = 10;
      switch (result.level) {
        case "province": zoomLevel = 6; break;
        case "regency": zoomLevel = 9; break;
        case "district": zoomLevel = 11; break;
        case "village":
        case "postal": zoomLevel = 13; break;
      }

      map.flyTo({
        center: [result.lng, result.lat],
        zoom: zoomLevel,
        essential: true,
      });

      // Fetch reverse geocode data to show the info modal automatically
      setSelectedFeature(null);
      setReverseCoords({ lat: result.lat, lng: result.lng });
      setReverseLoading(true);
      setHighlightedFeature(null);
      fetch(`/api/v1/boundaries/reverse?lat=${result.lat}&lng=${result.lng}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.data) {
            setReverseResult(json.data);
            const d = json.data;
            if (d.desa?.kode_desa) setHighlightedFeature({ source: "desa", id: d.desa.kode_desa });
            else if (d.kecamatan?.kode_kec) setHighlightedFeature({ source: "kecamatan", id: d.kecamatan.kode_kec });
            else if (d.kabupaten?.kode_kab) setHighlightedFeature({ source: "kabupaten", id: d.kabupaten.kode_kab });
            else if (d.provinsi?.kode_prov) setHighlightedFeature({ source: "provinsi", id: d.provinsi.kode_prov });
          }
        })
        .catch(() => { /* ignore */ })
        .finally(() => setReverseLoading(false));
    }
  }, []);

  return (
    <main className="min-h-screen relative flex flex-col bg-background selection:bg-primary/20">
      <Navbar />

      {/* ═══════════ HERO SECTION ═══════════ */}
      <section className="relative px-4 pt-28 pb-12 overflow-hidden flex flex-col items-center justify-center">
        {/* Background gradient mesh — Navy / Indigo theme */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50/60 via-background to-background dark:from-indigo-950/30 dark:via-background dark:to-background" />
        {/* Merah Putih accent blobs */}
        <div className="absolute top-0 left-1/3 w-[600px] h-[350px] bg-red-500/8 dark:bg-red-500/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
        <div className="absolute top-20 right-1/3 w-[500px] h-[300px] bg-indigo-500/10 dark:bg-indigo-500/6 rounded-full blur-[100px] -z-10 pointer-events-none" />
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 -z-[5] opacity-[0.03] dark:opacity-[0.04] pointer-events-none" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40H0z' fill='none'/%3E%3Cpath d='M0 40V0h1v40zm40 0V0h1' stroke='%23888' stroke-width='.5'/%3E%3Cpath d='M0 0h40v1H0zm0 40h40v1' stroke='%23888' stroke-width='.5'/%3E%3C/svg%3E\")" }} />

        <div className="max-w-5xl mx-auto space-y-8 text-center relative z-10 w-full">
          {/* Badge with flag */}
          <div className="flex justify-center">
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border-0 text-xs tracking-wide px-4 py-1.5 transition-colors">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse" />
              API Online · Open Source
            </Badge>
          </div>

          {/* Title with flag */}
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-4">
              <span className="text-4xl sm:text-5xl" role="img" aria-label="Bendera Indonesia">🇮🇩</span>
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight">
                <span className="bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 dark:from-indigo-400 dark:via-blue-400 dark:to-sky-400 bg-clip-text text-transparent">
                  wilayah-id
                </span>
              </h1>
            </div>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              REST API untuk <strong className="text-foreground font-semibold">Batas Administrasi Indonesia</strong>.{" "}
              Mencakup data Provinsi, Kabupaten/Kota, Kecamatan, Desa, hingga Kode Pos.
            </p>
          </div>

          {/* Animated Search Bar - Compact below title */}
          <div className="pt-2">
            <SearchAnimation />
          </div>

          {/* Quick cURL Snippet */}
          <div className="max-w-xl mx-auto w-full">
            <div className="rounded-xl overflow-hidden border border-indigo-500/20 dark:border-indigo-500/10 bg-zinc-950/90 shadow-2xl shadow-indigo-500/10 backdrop-blur-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
                <div className="flex space-x-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-white/80 border border-zinc-600" />
                  <div className="w-3 h-3 rounded-full bg-indigo-500" />
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText("curl https://wilayah-id-restapi.vercel.app/api/v1/regions/provinces")}
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
              </div>
              <div className="p-5 text-left overflow-x-auto">
                <code className="text-sm font-mono text-zinc-300">
                  <span className="text-indigo-400">curl</span> https://wilayah-id-restapi.vercel.app/api/v1/regions/provinces
                </code>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap justify-center gap-4 pt-2">
            <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/25 h-12 px-6 rounded-full" onClick={scrollToExplorer}>
              <Play className="w-4 h-4 mr-2 fill-current" />
              Coba API
            </Button>
            <Link href="/docs">
              <Button size="lg" variant="outline" className="h-12 px-6 rounded-full bg-background/50 backdrop-blur-sm border-2 border-indigo-500/30 hover:border-indigo-500/50">
                API Docs
              </Button>
            </Link>
            <Button size="lg" variant="secondary" className="h-12 px-6 rounded-full border shadow-sm hover:shadow-md transition-shadow" onClick={scrollToMap}>
              <MapPin className="w-4 h-4 mr-2" />
              Explore Map
            </Button>
          </div>
        </div>
      </section>

      {/* ═══════════ FEATURES GRID ═══════════ */}
      <section className="pb-16 pt-8 relative z-10 w-full">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight mb-4">API Features</h2>
            <p className="text-muted-foreground">Data lengkap dan terstruktur untuk kebutuhan aplikasi Anda.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <Card className="bg-background/60 backdrop-blur-sm border-muted shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                  <Globe className="w-6 h-6 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-2">Regions Data</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Hierarki wilayah administrasi dari tingkat Provinsi hingga Desa/Kelurahan.
                  </p>
                  <div className="space-y-2">
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-blue-500 mr-2">GET</span> /regions/provinces</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-blue-500 mr-2">GET</span> /regions/search</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="bg-background/60 backdrop-blur-sm border-muted shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                  <MapPin className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-2">GeoJSON & Reverse Geocode</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Dapatkan data batas Polygon GeoJSON atau cari wilayah berdasarkan titik koordinat lat/lng.
                  </p>
                  <div className="space-y-2">
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-emerald-500 mr-2">GET</span> /boundaries/reverse</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-emerald-500 mr-2">GET</span> /boundaries/villages?geometry=true</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="bg-background/60 backdrop-blur-sm border-muted shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                  <Search className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-2">Postal Codes</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Lookup kodepos di seluruh Indonesia atau cari wilayah berdasarkan kodepos.
                  </p>
                  <div className="space-y-2">
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-amber-500 mr-2">GET</span> /postal-codes?postal_code=12840</Badge>
                    <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-amber-500 mr-2">GET</span> /postal-codes/lookup?q=128</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Feature 4 - OGC Services */}
            <Card className="bg-background/60 backdrop-blur-sm border-muted shadow-sm hover:shadow-md transition-shadow md:col-span-3">
              <CardContent className="p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <Globe className="w-6 h-6 text-indigo-500" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold">OGC GIS Services (WMS/WFS)</h3>
                      <Link href="/ogc">
                        <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 border-0 text-xs w-fit">
                          Lihat Dokumentasi →
                        </Badge>
                      </Link>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Integrasi dengan QGIS, ArcGIS, dan aplikasi GIS lainnya menggunakan standar OGC (Open Geospatial Consortium). Mendukung WMS 1.3.0 dan WFS 2.0.0 dengan output GeoJSON dan GML.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-indigo-500 mr-2">WMS</span> /ogc/wms?REQUEST=GetCapabilities</Badge>
                      <Badge variant="secondary" className="font-mono text-[10px] w-full justify-start py-1.5"><span className="text-indigo-500 mr-2">WFS</span> /ogc/wfs?REQUEST=GetFeature</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ═══════════ MAP SECTION ═══════════ */}
      <section ref={mapSectionRef} className="relative w-full h-screen">
        <Map
          ref={mapRef}
          center={[118.0, -2.5]}
          zoom={5}
          minZoom={3}
          maxZoom={16}
          className="w-full h-full"
          onClick={handleMapRightClick}
        >
          <MapControls position="bottom-right" showCompass showFullscreen />
          {/* Boundary Vector Layers */}
          <VectorLayerManager
            layerVisibility={layerVisibility}
            onFeatureClick={handleFeatureClick}
            highlightedFeature={highlightedFeature}
          />
          {selectedFeature && (
            <MapPopup
              longitude={selectedFeature.lngLat.lng}
              latitude={selectedFeature.lngLat.lat}
              onClose={handleClosePopup}
              closeButton
            >
              <InfoPanel
                feature={selectedFeature.feature}
              />
            </MapPopup>
          )}
          
          {/* AOI Drawing Control */}
          <AOIDrawer
            mode={aoiMode}
            onDrawCreate={handleDrawCreate}
            onDrawUpdate={handleDrawUpdate}
            onDrawDelete={handleDrawDelete}
            clearDraw={clearDrawTrigger}
          />
        </Map>

        {/* Mobile panel toggle */}
        <Button
          variant="secondary"
          size="icon"
          className="absolute top-16 left-3 z-10 sm:hidden h-10 w-10"
          onClick={() => setShowPanels(!showPanels)}
        >
          {showPanels ? <X className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
        </Button>

        {/* Panels container - hidden on mobile when collapsed */}
        <div className={cn(
          "absolute top-28 left-3 z-10 flex flex-col gap-2 sm:top-16 transition-all duration-300",
          !showPanels && "hidden sm:flex"
        )}>
          <LayerPanel visibility={layerVisibility} onToggle={handleLayerToggle} />
          <DownloadByLevel />
          <DownloadPanel 
            onCreateAOI={handleCreateAOI}
            aoiBounds={aoiBounds}
            aoiFeatures={aoiFeatures}
            onClearAOI={handleDrawDelete}
          />
        </div>
        
        <MapSearchBar onResultSelect={handleSearchResult} />

        {/* Reverse geocode result panel */}
        {reverseCoords && (
          <div className="absolute top-28 right-4 z-20 w-full max-w-sm rounded-lg border bg-background/95 backdrop-blur-sm shadow-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">📍 Detail Informasi Wilayah</span>
              <button onClick={() => { setReverseCoords(null); setReverseResult(null); setHighlightedFeature(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {reverseCoords.lat.toFixed(6)}, {reverseCoords.lng.toFixed(6)}
            </div>
            {reverseLoading && <div className="text-xs text-muted-foreground">Loading...</div>}
            {reverseResult && (
              <div className="space-y-1 text-xs">
                {reverseResult.provinsi?.nama_provinsi && <div><span className="text-muted-foreground">Provinsi:</span> <strong>{reverseResult.provinsi.nama_provinsi}</strong></div>}
                {reverseResult.kabupaten?.nama_kabupaten && <div><span className="text-muted-foreground">Kabupaten:</span> <strong>{reverseResult.kabupaten.nama_kabupaten}</strong></div>}
                {reverseResult.kecamatan?.nama_kecamatan && <div><span className="text-muted-foreground">Kecamatan:</span> <strong>{reverseResult.kecamatan.nama_kecamatan}</strong></div>}
                {reverseResult.desa?.nama_desa && <div><span className="text-muted-foreground">Desa:</span> <strong>{reverseResult.desa.nama_desa}</strong></div>}
                {reverseResult.desa?.kode_pos && <div><span className="text-muted-foreground">Kode Pos:</span> <strong>{reverseResult.desa.kode_pos}</strong></div>}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══════════ API EXPLORER ═══════════ */}
      <section ref={apiExplorerRef} className="py-24 px-4 relative">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-bold tracking-tight">API Explorer</h2>
            <p className="text-muted-foreground">Test API langsung dari browser dengan live data.</p>
          </div>

          <Card className="max-w-3xl mx-auto shadow-xl border-muted bg-card overflow-hidden text-left">
            <div className="p-4 border-b bg-muted/30 flex flex-col sm:flex-row gap-3 items-center">
              <span className="text-sm font-semibold whitespace-nowrap hidden sm:inline-block">Select Endpoint</span>
              <div className="relative w-full">
                <select
                  className="w-full appearance-none bg-background border rounded-md py-2.5 pl-3 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedEndpoint}
                  onChange={(e) => setSelectedEndpoint(e.target.value)}
                >
                  <optgroup label="Regions">
                    <option value="/regions/provinces">GET /regions/provinces</option>
                    <option value="/regions/regencies?province_code=31">GET /regions/regencies?province_code=31</option>
                    <option value="/regions/districts?regency_code=3174">GET /regions/districts?regency_code=3174</option>
                    <option value="/regions/villages?district_code=317401">GET /regions/villages?district_code=317401</option>
                    <option value="/regions/search?q=tebet">GET /regions/search?q=tebet</option>
                  </optgroup>
                  <optgroup label="Boundaries">
                    <option value="/boundaries/reverse?lat=-6.2&lng=106.8">GET /boundaries/reverse?lat=-6.2&lng=106.8</option>
                    <option value="/boundaries/provinces/31?geometry=true">GET /boundaries/provinces/31?geometry=true</option>
                  </optgroup>
                  <optgroup label="Postal Codes">
                    <option value="/postal-codes?postal_code=12840">GET /postal-codes?postal_code=12840</option>
                    <option value="/postal-codes/lookup?q=128">GET /postal-codes/lookup?q=128</option>
                  </optgroup>
                  <optgroup label="OGC GIS Services">
                    <option value="/ogc/wms?SERVICE=WMS&REQUEST=GetCapabilities">WMS GetCapabilities</option>
                    <option value="/ogc/wfs?SERVICE=WFS&REQUEST=GetCapabilities">WFS GetCapabilities</option>
                    <option value="/ogc/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=provinces&OUTPUTFORMAT=application/json">WFS GetFeature (GeoJSON)</option>
                  </optgroup>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
              <Button onClick={runApiCall} disabled={apiLoading} className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
                <Play className="w-4 h-4 mr-2" />
                Execute
              </Button>
            </div>

            {(apiResult || apiLoading) && (
              <div className="relative bg-zinc-950 p-4 sm:p-6 min-h-[300px] max-h-[500px] overflow-auto border-t">
                <div className="absolute top-4 right-4 flex space-x-2">
                  {apiResult && (
                    <button onClick={() => navigator.clipboard.writeText(apiResult)} className="text-zinc-400 hover:text-white bg-zinc-800/50 p-1.5 rounded-md backdrop-blur-sm transition-colors">
                      <Copy className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                {apiLoading ? (
                  <div className="flex h-full items-center justify-center py-20">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <pre className="text-xs sm:text-sm font-mono text-zinc-300">
                    {apiResult}
                  </pre>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ═══════════ SELF-HOST SECTION ═══════════ */}
      <section className="py-24 bg-muted/30 relative border-t">
        <div className="max-w-3xl mx-auto px-4 text-center space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl font-extrabold flex items-center justify-center gap-3">
              🚀 Self-Host
            </h2>
            <p className="text-lg text-muted-foreground">
              Deploy instance mandiri dengan Docker dan PostgreSQL
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-5 rounded-2xl text-left shadow-inner max-w-2xl mx-auto">
            <AlertTriangle className="w-8 h-8 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-base">Vercel Free Tier</h4>
              <p className="text-sm leading-relaxed opacity-90">
                Website ini di-host di Vercel free tier dan hanya berfungsi sebagai demo testing API. Untuk production use, sangat disarankan untuk melakukan self-host.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Link href="/self-host">
              <Button size="lg" className="h-12 px-6 rounded-full shadow-lg shadow-blue-500/20">
                📖 Panduan Self-Host
              </Button>
            </Link>
            <a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="lg" className="h-12 px-6 rounded-full bg-background">
                <Github className="w-4 h-4 mr-2" />
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ═══════════ TECH STACK MARQUEE ═══════════ */}
      <TechStackMarquee />

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="border-t bg-muted/20 pb-12">
        <div className="max-w-5xl mx-auto px-4 pt-12">
          {/* Main Footer Content */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {/* Brand column */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🇮🇩</span>
                <span className="font-bold text-lg bg-gradient-to-r from-blue-600 to-violet-600 dark:from-blue-400 dark:to-violet-400 bg-clip-text text-transparent">wilayah-id</span>
              </div>
              <p className="text-sm text-muted-foreground">
                REST API untuk data batas administrasi dan kode pos seluruh Indonesia.
              </p>
            </div>

            {/* Links */}
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/docs" className="hover:text-foreground transition-colors">API Documentation</Link></li>
                <li><Link href="/ogc" className="hover:text-foreground transition-colors">GIS Services (WMS/WFS)</Link></li>
                <li><Link href="/self-host" className="hover:text-foreground transition-colors">Self-Hosting Guide</Link></li>
                <li><a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub Repository</a></li>
              </ul>
            </div>

            {/* Data Sources */}
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Data Sources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="https://gis.dukcapil.kemendagri.go.id/peta/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Batas Administrasi (Kemendagri 2024)
                  </a>
                </li>
                <li>
                  <a href="https://github.com/lokabisa-oss/region-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Kode Wilayah
                  </a>
                </li>
                <li>
                  <a href="https://github.com/lokabisa-oss/postal-code-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Kode Pos
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <Separator className="mb-8" />

          {/* Bottom attribution */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} wilayah-id. Open source (MIT License).</p>
            <div className="flex items-center gap-4">
              <a href="https://github.com/dhanyyudi" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Github className="w-3.5 h-3.5" />
                dhanyyudi
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
