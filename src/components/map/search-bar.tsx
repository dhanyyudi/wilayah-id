"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, X, Loader2, MapPin, Hash } from "lucide-react";

interface SearchResult {
  kode: string;
  nama: string;
  level: string;
  parent?: string;
  postal_code?: string;
  lng?: number;
  lat?: number;
}

interface MapSearchBarProps {
  onResultSelect?: (result: SearchResult) => void;
  onReverseGeocode?: (lat: number, lng: number) => void;
}

export default function MapSearchBar({ onResultSelect }: MapSearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchRegions = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }

    setLoading(true);
    try {
      const items: SearchResult[] = [];

      // Check if query looks like postal code (numeric)
      if (/^\d{2,5}$/.test(q)) {
        const postalRes = await fetch(`/api/v1/postal-codes/lookup?q=${encodeURIComponent(q)}`);
        const postalJson = await postalRes.json();
        if (postalJson.data) {
          for (const pc of postalJson.data.slice(0, 5)) {
            items.push({
              kode: pc.postal_code || pc.kode_pos,
              nama: `Kode Pos ${pc.postal_code || pc.kode_pos}`,
              level: "postal",
              parent: pc.nama_desa ? `${pc.nama_desa}, ${pc.nama_kecamatan || ""}` : undefined,
              lng: pc.lng,
              lat: pc.lat,
            });
          }
        }
      }

      // Also search regions
      const regionRes = await fetch(`/api/v1/regions/search?q=${encodeURIComponent(q)}`);
      const regionJson = await regionRes.json();
      if (regionJson.data) {
        for (const r of regionJson.data.slice(0, 8)) {
          // Map the API fields to SearchResult interface properties
          const parentDesc = r.level === "village" ? `${r.nama_kecamatan}, ${r.nama_kabupaten}, ${r.nama_provinsi}` :
                             r.level === "district" ? `${r.nama_kabupaten}, ${r.nama_provinsi}` :
                             r.level === "regency" ? r.nama_provinsi : undefined;

          items.push({
            kode: r.code,
            nama: r.name,
            level: r.level || "region",
            parent: parentDesc || r.parent_name,
            lng: r.lng,
            lat: r.lat,
          });
        }
      }

      setResults(items);
      setOpen(items.length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchRegions(value), 300);
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery(result.nama || "");
    onResultSelect?.(result);
  };

  const levelBadgeColor = (level: string) => {
    switch (level) {
      case "province": return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
      case "regency": return "bg-purple-500/15 text-purple-600 dark:text-purple-400";
      case "district": return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
      case "village": return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
      case "postal": return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const levelLabel = (level: string) => {
    switch (level) {
      case "province": return "Provinsi";
      case "regency": return "Kab/Kota";
      case "district": return "Kecamatan";
      case "village": return "Desa";
      case "postal": return "Kode Pos";
      default: return level;
    }
  };

  return (
    <div ref={containerRef} className="absolute top-14 left-4 right-4 sm:left-auto sm:right-4 sm:w-72 z-20">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Cari wilayah atau kode pos..."
          value={query || ""}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full pl-9 pr-8 py-2.5 rounded-lg border bg-background/95 backdrop-blur-sm text-sm shadow-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
        {!loading && query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="mt-1 rounded-lg border bg-background/95 backdrop-blur-sm shadow-xl max-h-72 overflow-auto">
          {results.map((r, i) => (
            <button
              key={`${r.kode}-${i}`}
              className="w-full text-left px-3 py-2.5 hover:bg-muted flex items-start gap-2.5 border-b last:border-b-0 transition-colors"
              onClick={() => handleSelect(r)}
            >
              {r.level === "postal" ? (
                <Hash className="w-3.5 h-3.5 mt-0.5 text-rose-500 shrink-0" />
              ) : (
                <MapPin className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{r.nama}</span>
                  <span className={`text-[9px] px-1 py-0 rounded font-medium shrink-0 ${levelBadgeColor(r.level)}`}>
                    {levelLabel(r.level)}
                  </span>
                </div>
                {r.parent && (
                  <div className="text-[11px] text-muted-foreground truncate">{r.parent}</div>
                )}
                <div className="text-[10px] text-muted-foreground font-mono">{r.kode}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
