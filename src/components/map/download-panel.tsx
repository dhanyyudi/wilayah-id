"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  FileJson, 
  FileSpreadsheet, 
  Loader2,
  Check,
  X,
  Square,
  Pentagon,
  AlertCircle,
  Map as MapIcon,
  Trash2
} from "lucide-react";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { LngLatBounds } from "maplibre-gl";

interface DownloadPanelProps {
  className?: string;
  onCreateAOI?: (mode: "rectangle" | "polygon" | null) => void;
  aoiBounds?: LngLatBounds | null | undefined;
  aoiFeatures?: Feature[];
  onClearAOI?: () => void;
}

type DataType = "spatial" | "tabular" | null;
type SpatialLevel = "regencies" | "districts" | "villages" | null;
type TabularType = "regions" | "postal" | null;
type AOIMode = "rectangle" | "polygon" | null;

// Calculate AOI size in square degrees (rough estimation)
function getAOISizeSquareDeg(bounds: LngLatBounds | null | undefined): number {
  if (!bounds) return Infinity;
  const width = bounds.getEast() - bounds.getWest();
  const height = bounds.getNorth() - bounds.getSouth();
  return Math.abs(width * height);
}

function getAOISizeDescription(bounds: LngLatBounds | null | undefined): { size: "small" | "medium" | "large" | "xlarge"; description: string } {
  const area = getAOISizeSquareDeg(bounds);
  
  if (area < 0.5) {
    return { size: "small", description: "Area sangat kecil (Desa)" };
  } else if (area < 2) {
    return { size: "medium", description: "Area kecil (Kecamatan)" };
  } else if (area < 10) {
    return { size: "large", description: "Area sedang (Kabupaten)" };
  } else {
    return { size: "xlarge", description: "Area besar (Provinsi+)" };
  }
}

function getLevelName(level: SpatialLevel): string {
  switch (level) {
    case "regencies": return "Kabupaten/Kota";
    case "districts": return "Kecamatan";
    case "villages": return "Desa/Kelurahan";
    default: return "";
  }
}

// Get available levels based on AOI size
function getAvailableLevels(bounds: LngLatBounds | null | undefined): SpatialLevel[] {
  const { size } = getAOISizeDescription(bounds);
  
  switch (size) {
    case "small":
      return ["villages", "districts", "regencies"]; // All levels, warn for larger
    case "medium":
      return ["villages", "districts", "regencies"];
    case "large":
      return ["districts", "regencies"]; // Villages might be too much
    case "xlarge":
      return ["regencies"]; // Only regencies for very large areas
    default:
      return ["regencies", "districts", "villages"];
  }
}

export default function DownloadPanel({ 
  className, 
  onCreateAOI, 
  aoiBounds,
  aoiFeatures = [],
  onClearAOI
}: DownloadPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<"aoi" | "type" | "level" | "format">("aoi");
  const [aoiMode, setAoiMode] = useState<AOIMode>(null);
  const [dataType, setDataType] = useState<DataType>(null);
  const [spatialLevel, setSpatialLevel] = useState<SpatialLevel>(null);
  const [tabularType, setTabularType] = useState<TabularType>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const hasAOI = aoiFeatures.length > 0;
  const aoiInfo = getAOISizeDescription(aoiBounds);
  const availableLevels = getAvailableLevels(aoiBounds);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setStep(hasAOI ? "type" : "aoi");
      setAoiMode(null);
      setDataType(null);
      setSpatialLevel(null);
      setTabularType(null);
      setSuccess(false);
    }
  }, [isOpen, hasAOI]);

  const handleStartAOI = (mode: AOIMode) => {
    setAoiMode(mode);
    if (onCreateAOI) {
      onCreateAOI(mode);
    }
  };

  const handleAOIDone = () => {
    if (hasAOI) {
      setAoiMode(null);
      setStep("type");
      if (onCreateAOI) onCreateAOI(null); // Stop drawing mode
    }
  };

  const handleClearAOI = () => {
    if (onClearAOI) onClearAOI();
    setStep("aoi");
    setSpatialLevel(null);
  };

  const handleSelectDataType = (type: DataType) => {
    setDataType(type);
    if (type === "spatial") {
      setStep("level");
      // Auto-select appropriate level based on AOI size
      if (availableLevels.length === 1) {
        setSpatialLevel(availableLevels[0]);
      }
    } else {
      setStep("format");
    }
  };

  const handleSelectSpatialLevel = (level: SpatialLevel) => {
    setSpatialLevel(level);
    setStep("format");
  };

  const handleDownload = useCallback(async () => {
    setLoading(true);
    setSuccess(false);
    
    try {
      if (dataType === "spatial" && spatialLevel && aoiBounds) {
        // Spatial data - use WFS with AOI bounds
        const bbox = `${aoiBounds.getWest()},${aoiBounds.getSouth()},${aoiBounds.getEast()},${aoiBounds.getNorth()}`;
        const endpoint = `/api/v1/ogc/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=${spatialLevel}&BBOX=${bbox}&OUTPUTFORMAT=application/json`;
        
        const response = await fetch(endpoint);
        const data = await response.json();
        
        // Download as GeoJSON
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/geo+json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${spatialLevel}_aoi_${Date.now()}.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
      } else if (dataType === "tabular" && tabularType) {
        if (tabularType === "regions") {
          // Tabular: Use regions API
          const endpoint = "/api/v1/regions/provinces";
          const response = await fetch(endpoint);
          const data = await response.json();
          
          // Convert to CSV
          const items = data.data || [];
          if (items.length > 0) {
            const headers = Object.keys(items[0]).filter(h => h !== "geom" && h !== "geometry");
            const csv = [
              headers.join(","),
              ...items.map((item: any) => 
                headers.map(h => {
                  const val = item[h];
                  return typeof val === "string" && val.includes(",") 
                    ? `"${val}"` 
                    : val;
                }).join(",")
              ),
            ].join("\n");
            
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "region_codes.csv";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
        } else if (tabularType === "postal") {
          alert("Fitur download kode pos akan segera hadir!");
        }
      }
      
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setIsOpen(false);
      }, 2000);
    } catch (error) {
      console.error("Download error:", error);
      alert("Gagal mengunduh data. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [dataType, spatialLevel, tabularType, aoiBounds]);

  const canDownload = 
    (dataType === "spatial" && spatialLevel) || 
    (dataType === "tabular" && tabularType);

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="w-full gap-2"
        onClick={() => setIsOpen(true)}
      >
        <Download className="w-4 h-4" />
        Unduh dengan Area
      </Button>
    );
  }

  return (
    <Card className={`w-72 shadow-xl ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">Unduh dengan Area</CardTitle>
          </div>
          <button 
            onClick={() => {
              setIsOpen(false);
              if (onCreateAOI) onCreateAOI(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Steps */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`px-2 py-0.5 rounded ${step === "aoi" ? "bg-blue-500 text-white" : hasAOI ? "bg-green-500/20 text-green-600" : "bg-muted"}`}>1. Area</span>
          <span className="text-muted-foreground">→</span>
          <span className={`px-2 py-0.5 rounded ${step === "type" ? "bg-blue-500 text-white" : step === "level" || step === "format" ? "bg-green-500/20 text-green-600" : "bg-muted"}`}>2. Tipe</span>
          <span className="text-muted-foreground">→</span>
          <span className={`px-2 py-0.5 rounded ${step === "level" ? "bg-blue-500 text-white" : step === "format" ? "bg-green-500/20 text-green-600" : "bg-muted"}`}>3. Level</span>
        </div>

        {/* STEP 1: Create AOI */}
        {step === "aoi" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Buat Area of Interest (AOI) di peta:
            </p>
            
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleStartAOI("rectangle")}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                  aoiMode === "rectangle" 
                    ? "border-blue-500 bg-blue-500/10" 
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <Square className="w-5 h-5" />
                <span className="text-[10px]">Persegi Panjang</span>
              </button>
              <button
                onClick={() => handleStartAOI("polygon")}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-colors ${
                  aoiMode === "polygon" 
                    ? "border-blue-500 bg-blue-500/10" 
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <Pentagon className="w-5 h-5" />
                <span className="text-[10px]">Polygon Bebas</span>
              </button>
            </div>

            {aoiMode && (
              <div className="space-y-2">
                <p className="text-xs text-amber-600 bg-amber-500/10 p-2 rounded">
                  <AlertCircle className="w-3 h-3 inline mr-1" />
                  {aoiMode === "rectangle" 
                    ? "Klik titik sudut di peta untuk membuat persegi (min 4 titik), double-click untuk selesai" 
                    : "Klik titik-titik di peta untuk membuat polygon, double-click untuk selesai"}
                </p>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Select Data Type */}
        {step === "type" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Pilih tipe data:</p>
              <button 
                onClick={() => setStep("aoi")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Ubah Area
              </button>
            </div>

            {hasAOI && (
              <div className="text-xs bg-blue-500/10 border border-blue-500/20 p-2 rounded">
                <p className="text-blue-700 dark:text-blue-300">
                  ✓ Area: <strong>{aoiInfo.description}</strong>
                </p>
              </div>
            )}
            
            <div className="space-y-2">
              <button
                onClick={() => handleSelectDataType("spatial")}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  dataType === "spatial" 
                    ? "border-emerald-500 bg-emerald-500/10" 
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <MapIcon className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Data Spasial</p>
                  <p className="text-[10px] text-muted-foreground truncate">GeoJSON dengan geometri (peta)</p>
                </div>
              </button>
              
              <button
                onClick={() => handleSelectDataType("tabular")}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  dataType === "tabular" 
                    ? "border-amber-500 bg-amber-500/10" 
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Data Tabular</p>
                  <p className="text-[10px] text-muted-foreground truncate">CSV: kode wilayah atau kode pos</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Select Level (only for spatial) */}
        {step === "level" && dataType === "spatial" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Pilih level data:</p>
              <button 
                onClick={() => setStep("type")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Kembali
              </button>
            </div>

            {/* AOI Info */}
            <div className="text-xs bg-blue-500/10 border border-blue-500/20 p-2 rounded">
              <p className="text-blue-700 dark:text-blue-300">
                Area Anda: <strong>{aoiInfo.description}</strong>
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Hanya level yang sesuai ditampilkan.
              </p>
            </div>
            
            <div className="space-y-1.5">
              {availableLevels.includes("regencies") && (
                <button
                  onClick={() => handleSelectSpatialLevel("regencies")}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                    spatialLevel === "regencies" 
                      ? "border-blue-500 bg-blue-500/10" 
                      : "border-muted hover:border-muted-foreground/50"
                  }`}
                >
                  <span className="text-sm">Kabupaten/Kota</span>
                  <Badge variant="secondary" className="text-[10px]">~514</Badge>
                </button>
              )}

              {availableLevels.includes("districts") && (
                <button
                  onClick={() => handleSelectSpatialLevel("districts")}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                    spatialLevel === "districts" 
                      ? "border-blue-500 bg-blue-500/10" 
                      : "border-muted hover:border-muted-foreground/50"
                  }`}
                >
                  <span className="text-sm">Kecamatan</span>
                  <Badge variant="secondary" className="text-[10px]">~7.200</Badge>
                </button>
              )}

              {availableLevels.includes("villages") && (
                <button
                  onClick={() => handleSelectSpatialLevel("villages")}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                    spatialLevel === "villages" 
                      ? "border-blue-500 bg-blue-500/10" 
                      : "border-muted hover:border-muted-foreground/50"
                  }`}
                >
                  <span className="text-sm">Desa/Kelurahan</span>
                  <Badge variant="secondary" className="text-[10px]">~74.000</Badge>
                </button>
              )}

              {aoiInfo.size === "xlarge" && availableLevels.includes("villages") && (
                <p className="text-[10px] text-amber-600 mt-2">
                  ⚠️ Download Desa untuk area besar akan memakan waktu dan menghasilkan file besar.
                </p>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: Confirm & Download */}
        {step === "format" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Konfirmasi:</p>
              <button 
                onClick={() => dataType === "spatial" ? setStep("level") : setStep("type")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Kembali
              </button>
            </div>

            {/* Summary */}
            <div className="bg-muted p-3 rounded-lg space-y-1 text-xs">
              <p><span className="text-muted-foreground">Tipe:</span> {dataType === "spatial" ? "Data Spasial (GeoJSON)" : "Data Tabular (CSV)"}</p>
              {dataType === "spatial" && spatialLevel && (
                <p><span className="text-muted-foreground">Level:</span> {getLevelName(spatialLevel)}</p>
              )}
              {dataType === "tabular" && tabularType && (
                <p><span className="text-muted-foreground">Data:</span> {tabularType === "regions" ? "Kode Wilayah" : "Kode Pos"}</p>
              )}
              <p><span className="text-muted-foreground">Area:</span> {aoiInfo.description}</p>
            </div>

            {/* For tabular, show type selector if not selected */}
            {dataType === "tabular" && !tabularType && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Pilih jenis data:</p>
                <button
                  onClick={() => setTabularType("regions")}
                  className="w-full p-2.5 rounded-lg border border-muted hover:border-amber-500/50 text-left"
                >
                  <p className="text-sm font-medium">Kode Wilayah</p>
                  <p className="text-[10px] text-muted-foreground">Kode Provinsi, Kabupaten, Kecamatan, Desa</p>
                </button>
                <button
                  onClick={() => setTabularType("postal")}
                  className="w-full p-2.5 rounded-lg border border-muted hover:border-amber-500/50 text-left"
                >
                  <p className="text-sm font-medium">Kode Pos</p>
                  <p className="text-[10px] text-muted-foreground">Data kode pos Indonesia</p>
                </button>
              </div>
            )}

            <Button
              onClick={handleDownload}
              disabled={!canDownload || loading}
              className="w-full gap-2"
              variant={success ? "outline" : "default"}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Mengunduh...
                </>
              ) : success ? (
                <>
                  <Check className="w-4 h-4 text-emerald-500" />
                  Berhasil!
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Unduh {dataType === "spatial" ? "GeoJSON" : "CSV"}
                </>
              )}
            </Button>

            {hasAOI && (
              <Button
                onClick={handleClearAOI}
                variant="ghost"
                size="sm"
                className="w-full gap-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
                Hapus Area & Ulangi
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
