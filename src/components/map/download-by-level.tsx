"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Download, 
  FileJson, 
  FileSpreadsheet, 
  Loader2,
  Check,
  ChevronDown,
  X,
  Database
} from "lucide-react";

interface DownloadByLevelProps {
  className?: string;
}

type DownloadBy = "province" | "regency" | "district" | null;
type Level = "provinces" | "regencies" | "districts" | "villages";
type Format = "geojson" | "csv";

const PROVINCES = [
  { code: "11", name: "Aceh" },
  { code: "12", name: "Sumatera Utara" },
  { code: "13", name: "Sumatera Barat" },
  { code: "14", name: "Riau" },
  { code: "15", name: "Jambi" },
  { code: "16", name: "Sumatera Selatan" },
  { code: "17", name: "Bengkulu" },
  { code: "18", name: "Lampung" },
  { code: "19", name: "Kepulauan Bangka Belitung" },
  { code: "21", name: "Kepulauan Riau" },
  { code: "31", name: "DKI Jakarta" },
  { code: "32", name: "Jawa Barat" },
  { code: "33", name: "Jawa Tengah" },
  { code: "34", name: "DI Yogyakarta" },
  { code: "35", name: "Jawa Timur" },
  { code: "36", name: "Banten" },
  { code: "51", name: "Bali" },
  { code: "52", name: "Nusa Tenggara Barat" },
  { code: "53", name: "Nusa Tenggara Timur" },
  { code: "61", name: "Kalimantan Barat" },
  { code: "62", name: "Kalimantan Tengah" },
  { code: "63", name: "Kalimantan Selatan" },
  { code: "64", name: "Kalimantan Timur" },
  { code: "65", name: "Kalimantan Utara" },
  { code: "71", name: "Sulawesi Utara" },
  { code: "72", name: "Sulawesi Tengah" },
  { code: "73", name: "Sulawesi Selatan" },
  { code: "74", name: "Sulawesi Tenggara" },
  { code: "75", name: "Gorontalo" },
  { code: "76", name: "Sulawesi Barat" },
  { code: "81", name: "Maluku" },
  { code: "82", name: "Maluku Utara" },
  { code: "91", name: "Papua" },
  { code: "92", name: "Papua Barat" },
  { code: "93", name: "Papua Selatan" },
  { code: "94", name: "Papua Tengah" },
  { code: "95", name: "Papua Pegunungan" },
  { code: "96", name: "Papua Barat Daya" },
];

// Available levels based on download-by selection
function getAvailableLevels(downloadBy: DownloadBy): { level: Level; label: string; count: string }[] {
  switch (downloadBy) {
    case "province":
      return [
        { level: "provinces", label: "Provinsi", count: "1" },
        { level: "regencies", label: "Kabupaten/Kota", count: "~6-29" },
        { level: "districts", label: "Kecamatan", count: "~100-700" },
        { level: "villages", label: "Desa/Kelurahan", count: "~1.000-10.000" },
      ];
    case "regency":
      return [
        { level: "regencies", label: "Kabupaten/Kota", count: "1" },
        { level: "districts", label: "Kecamatan", count: "~10-25" },
        { level: "villages", label: "Desa/Kelurahan", count: "~100-400" },
      ];
    case "district":
      return [
        { level: "districts", label: "Kecamatan", count: "1" },
        { level: "villages", label: "Desa/Kelurahan", count: "~10-25" },
      ];
    default:
      return [];
  }
}

function getLevelName(level: Level): string {
  switch (level) {
    case "provinces": return "Provinsi";
    case "regencies": return "Kabupaten/Kota";
    case "districts": return "Kecamatan";
    case "villages": return "Desa/Kelurahan";
    default: return "";
  }
}

export default function DownloadByLevel({ className }: DownloadByLevelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<"by" | "select" | "level" | "format">("by");
  const [downloadBy, setDownloadBy] = useState<DownloadBy>(null);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [format, setFormat] = useState<Format>("geojson");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setStep("by");
    setDownloadBy(null);
    setSelectedCode("");
    setSelectedLevel(null);
    setFormat("geojson");
    setSuccess(false);
  };

  const handleSelectDownloadBy = (by: DownloadBy) => {
    setDownloadBy(by);
    setStep("select");
  };

  const handleSelectCode = (code: string) => {
    setSelectedCode(code);
    setStep("level");
  };

  const handleSelectLevel = (level: Level) => {
    setSelectedLevel(level);
    setStep("format");
  };

  const handleDownload = useCallback(async () => {
    if (!selectedCode || !selectedLevel) return;
    
    setLoading(true);
    setSuccess(false);
    
    try {
      let endpoint = "/api/v1";
      
      // Build endpoint based on level
      if (selectedLevel === "provinces") {
        endpoint = `${endpoint}/boundaries/provinces/${selectedCode}`;
        if (format === "geojson") endpoint += "?geometry=true";
      } else if (selectedLevel === "regencies") {
        if (downloadBy === "province") {
          endpoint = `${endpoint}/boundaries/regencies?province_code=${selectedCode}`;
        } else {
          endpoint = `${endpoint}/boundaries/regencies/${selectedCode}`;
          if (format === "geojson") endpoint += "?geometry=true";
        }
      } else if (selectedLevel === "districts") {
        if (downloadBy === "province") {
          // Get all districts in province via regions API
          endpoint = `${endpoint}/regions/districts?province_code=${selectedCode}`;
        } else if (downloadBy === "regency") {
          endpoint = `${endpoint}/boundaries/districts?regency_code=${selectedCode}`;
        } else {
          endpoint = `${endpoint}/boundaries/districts/${selectedCode}`;
          if (format === "geojson") endpoint += "?geometry=true";
        }
      } else if (selectedLevel === "villages") {
        if (downloadBy === "province") {
          endpoint = `${endpoint}/regions/villages?province_code=${selectedCode}`;
        } else if (downloadBy === "regency") {
          endpoint = `${endpoint}/regions/villages?regency_code=${selectedCode}`;
        } else {
          endpoint = `${endpoint}/regions/villages?district_code=${selectedCode}`;
        }
      }
      
      const response = await fetch(endpoint);
      const data = await response.json();
      
      if (format === "geojson") {
        // Convert to GeoJSON format
        let exportData;
        if (data.type === "Feature" || data.type === "FeatureCollection") {
          exportData = data;
        } else if (data.data) {
          const items = Array.isArray(data.data) ? data.data : [data.data];
          exportData = {
            type: "FeatureCollection",
            features: items.map((item: any) => ({
              type: "Feature",
              properties: { ...item, geom: undefined, geometry: undefined },
              geometry: item.geom || item.geometry || null,
            })),
          };
        } else {
          exportData = data;
        }
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/geo+json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${selectedLevel}_${selectedCode}.geojson`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // CSV format
        let items = data.data || (data.features ? data.features.map((f: any) => f.properties) : [data]);
        if (!Array.isArray(items)) items = [items];
        
        if (items.length > 0) {
          const headers = Object.keys(items[0]).filter(h => h !== "geom" && h !== "geometry");
          const csv = [
            headers.join(","),
            ...items.map((item: any) => 
              headers.map(h => {
                const val = item[h];
                return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
              }).join(",")
            ),
          ].join("\n");
          
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${selectedLevel}_${selectedCode}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }
      
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setIsOpen(false);
        reset();
      }, 2000);
    } catch (error) {
      console.error("Download error:", error);
      alert("Gagal mengunduh data. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [selectedCode, selectedLevel, format, downloadBy]);

  const availableLevels = getAvailableLevels(downloadBy);

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="w-full gap-2"
        onClick={() => setIsOpen(true)}
      >
        <Download className="w-4 h-4" />
        Unduh Data
      </Button>
    );
  }

  return (
    <Card className={`w-72 shadow-xl ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">Unduh Data</CardTitle>
          </div>
          <button 
            onClick={() => { setIsOpen(false); reset(); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Steps */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`px-2 py-0.5 rounded ${step === "by" ? "bg-blue-500 text-white" : "bg-muted"}`}>1. Berdasarkan</span>
          <span className="text-muted-foreground">→</span>
          <span className={`px-2 py-0.5 rounded ${step === "select" ? "bg-blue-500 text-white" : step === "level" || step === "format" ? "bg-green-500/20" : "bg-muted"}`}>2. Pilih</span>
          <span className="text-muted-foreground">→</span>
          <span className={`px-2 py-0.5 rounded ${step === "level" ? "bg-blue-500 text-white" : step === "format" ? "bg-green-500/20" : "bg-muted"}`}>3. Level</span>
        </div>

        {/* STEP 1: Select Download By */}
        {step === "by" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Unduh data berdasarkan:
            </p>
            
            <div className="space-y-2">
              <button
                onClick={() => handleSelectDownloadBy("province")}
                className={`w-full p-3 rounded-lg border transition-colors text-left ${
                  downloadBy === "province" ? "border-blue-500 bg-blue-500/10" : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <p className="text-sm font-medium">Provinsi</p>
                <p className="text-[10px] text-muted-foreground">Pilih provinsi, lalu unduh data provinsi/kab/kec/desa</p>
              </button>
              
              <button
                onClick={() => handleSelectDownloadBy("regency")}
                className={`w-full p-3 rounded-lg border transition-colors text-left ${
                  downloadBy === "regency" ? "border-blue-500 bg-blue-500/10" : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <p className="text-sm font-medium">Kabupaten/Kota</p>
                <p className="text-[10px] text-muted-foreground">Pilih kabupaten, lalu unduh data kab/kec/desa</p>
              </button>
              
              <button
                onClick={() => handleSelectDownloadBy("district")}
                className={`w-full p-3 rounded-lg border transition-colors text-left ${
                  downloadBy === "district" ? "border-blue-500 bg-blue-500/10" : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <p className="text-sm font-medium">Kecamatan</p>
                <p className="text-[10px] text-muted-foreground">Pilih kecamatan, lalu unduh data kec/desa</p>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Select Province/Regency/District */}
        {step === "select" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                Pilih {downloadBy === "province" ? "Provinsi" : downloadBy === "regency" ? "Kabupaten/Kota" : "Kecamatan"}:
              </p>
              <button 
                onClick={() => setStep("by")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Kembali
              </button>
            </div>
            
            <div className="relative">
              <select
                value={selectedCode}
                onChange={(e) => handleSelectCode(e.target.value)}
                className="w-full appearance-none bg-background border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">
                  Pilih {downloadBy === "province" ? "Provinsi" : downloadBy === "regency" ? "Kabupaten/Kota" : "Kecamatan"}...
                </option>
                {downloadBy === "province" && PROVINCES.map((p) => (
                  <option key={p.code} value={p.code}>{p.name}</option>
                ))}
                {downloadBy === "regency" && (
                  <optgroup label="Pilih Provinsi Dulu (Simplified)">
                    <option value="3174">Kota Jakarta Selatan (31)</option>
                    <option value="3173">Kota Jakarta Pusat (31)</option>
                    <option value="3276">Kota Bandung (32)</option>
                    <option value="3374">Kota Semarang (33)</option>
                    <option value="3578">Kota Surabaya (35)</option>
                  </optgroup>
                )}
                {downloadBy === "district" && (
                  <optgroup label="Pilih Kecamatan (Simplified)">
                    <option value="317401">Tebet (Jakarta Selatan)</option>
                    <option value="317402">Setiabudi (Jakarta Selatan)</option>
                    <option value="327601">Coblong (Bandung)</option>
                  </optgroup>
                )}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
            
            {downloadBy !== "province" && (
              <p className="text-[10px] text-amber-600 bg-amber-500/10 p-2 rounded">
                ℹ️ Untuk demo, hanya beberapa opsi tersedia. Gunakan API langsung untuk data lengkap.
              </p>
            )}
          </div>
        )}

        {/* STEP 3: Select Level */}
        {step === "level" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Pilih level data:</p>
              <button 
                onClick={() => setStep("select")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Kembali
              </button>
            </div>
            
            <div className="space-y-1.5">
              {availableLevels.map(({ level, label, count }) => (
                <button
                  key={level}
                  onClick={() => handleSelectLevel(level)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                    selectedLevel === level ? "border-blue-500 bg-blue-500/10" : "border-muted hover:border-muted-foreground/50"
                  }`}
                >
                  <span className="text-sm">{label}</span>
                  <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: Format & Download */}
        {step === "format" && selectedLevel && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">Format & Download:</p>
              <button 
                onClick={() => setStep("level")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                ← Kembali
              </button>
            </div>

            {/* Summary */}
            <div className="bg-muted p-3 rounded-lg space-y-1 text-xs">
              <p><span className="text-muted-foreground">Level:</span> {getLevelName(selectedLevel)}</p>
              <p><span className="text-muted-foreground">Kode:</span> {selectedCode}</p>
            </div>

            {/* Format Selection */}
            <div className="flex gap-2">
              <button
                onClick={() => setFormat("geojson")}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  format === "geojson" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" : "bg-muted border border-transparent"
                }`}
              >
                <FileJson className="w-3.5 h-3.5" />
                GeoJSON
              </button>
              <button
                onClick={() => setFormat("csv")}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  format === "csv" ? "bg-amber-500/10 text-amber-600 border border-amber-500/30" : "bg-muted border border-transparent"
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                CSV
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {format === "geojson" ? "GeoJSON: Data dengan geometri (peta)" : "CSV: Data tabular tanpa geometri"}
            </p>

            <Button
              onClick={handleDownload}
              disabled={loading}
              className="w-full gap-2"
              variant={success ? "outline" : "default"}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Mengunduh...</>
              ) : success ? (
                <><Check className="w-4 h-4 text-emerald-500" /> Berhasil!</>
              ) : (
                <><Download className="w-4 h-4" /> Unduh {format === "geojson" ? "GeoJSON" : "CSV"}</>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
