"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Play, Copy, ArrowLeft, Globe, MapPin, Hash, Moon, Sun, Github, ChevronRight, ChevronDown } from "lucide-react";
import { useTheme } from "next-themes";

/* ── Endpoint definitions ─────────────────────────── */
const ENDPOINT_GROUPS = [
  {
    category: "Regions",
    icon: Globe,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    endpoints: [
      { method: "GET", path: "/regions/provinces", desc: "List semua provinsi", example: "/regions/provinces" },
      { method: "GET", path: "/regions/provinces/:kode", desc: "Detail provinsi", example: "/regions/provinces/31" },
      { method: "GET", path: "/regions/regencies", desc: "List kabupaten/kota", example: "/regions/regencies?province_code=31" },
      { method: "GET", path: "/regions/regencies/:kode", desc: "Detail kabupaten", example: "/regions/regencies/3174" },
      { method: "GET", path: "/regions/districts", desc: "List kecamatan", example: "/regions/districts?regency_code=3174" },
      { method: "GET", path: "/regions/districts/:kode", desc: "Detail kecamatan", example: "/regions/districts/317401" },
      { method: "GET", path: "/regions/villages", desc: "List desa/kelurahan", example: "/regions/villages?district_code=317401" },
      { method: "GET", path: "/regions/villages/:kode", desc: "Detail desa + hierarki", example: "/regions/villages/3174011001" },
      { method: "GET", path: "/regions/search", desc: "Cari wilayah multi-level", example: "/regions/search?q=tebet" },
    ],
  },
  {
    category: "Boundaries (GeoJSON)",
    icon: MapPin,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    endpoints: [
      { method: "GET", path: "/boundaries/provinces", desc: "Batas provinsi + geometry", example: "/boundaries/provinces?geometry=true" },
      { method: "GET", path: "/boundaries/provinces/:kode", desc: "Single provinsi boundary", example: "/boundaries/provinces/31?geometry=true" },
      { method: "GET", path: "/boundaries/regencies", desc: "Batas kabupaten", example: "/boundaries/regencies?province_code=31&geometry=true" },
      { method: "GET", path: "/boundaries/regencies/:kode", desc: "Single kabupaten", example: "/boundaries/regencies/3174?geometry=true" },
      { method: "GET", path: "/boundaries/districts", desc: "Batas kecamatan", example: "/boundaries/districts?regency_code=3174&geometry=true" },
      { method: "GET", path: "/boundaries/districts/:kode", desc: "Single kecamatan", example: "/boundaries/districts/317401?geometry=true" },
      { method: "GET", path: "/boundaries/villages", desc: "Batas desa", example: "/boundaries/villages?district_code=317401&geometry=true" },
      { method: "GET", path: "/boundaries/villages/:kode", desc: "Single desa", example: "/boundaries/villages/3174011001?geometry=true" },
      { method: "GET", path: "/boundaries/reverse", desc: "Koordinat → wilayah", example: "/boundaries/reverse?lat=-6.2088&lng=106.8456" },
    ],
  },
  {
    category: "Postal Codes",
    icon: Hash,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    endpoints: [
      { method: "GET", path: "/postal-codes", desc: "Query kode pos by filter", example: "/postal-codes?postal_code=12840" },
      { method: "GET", path: "/postal-codes/lookup", desc: "Lookup prefix kode pos", example: "/postal-codes/lookup?q=128" },
    ],
  },
];

function EndpointRow({ ep, groupColor }: { ep: typeof ENDPOINT_GROUPS[0]["endpoints"][0]; groupColor: string }) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runCall = async () => {
    if (!ep.example) return;
    setExpanded(true);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/v1${ep.example}`);
      const json = await res.json();
      setResult(JSON.stringify(json, null, 2));
    } catch {
      setResult('{"error": "Request failed"}');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group">
      <div
        className="flex items-center gap-3 py-3 px-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors -mx-1"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}

        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono shrink-0 uppercase">
          {ep.method}
        </Badge>

        <code className="text-sm font-mono flex-1 truncate">{ep.path}</code>

        <span className="text-xs text-muted-foreground hidden sm:inline">{ep.desc}</span>

        {ep.example && (
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${groupColor}`}
            onClick={(e) => { e.stopPropagation(); runCall(); }}
          >
            <Play className="w-3 h-3 mr-1" />
            Try
          </Button>
        )}
      </div>

      {expanded && (
        <div className="ml-8 mb-3 space-y-2">
          <p className="text-xs text-muted-foreground sm:hidden">{ep.desc}</p>

          {ep.example && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Example:</span>
              <code className="font-mono bg-muted px-2 py-0.5 rounded">/api/v1{ep.example}</code>
              {!result && (
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={runCall} disabled={loading}>
                  <Play className="w-2.5 h-2.5 mr-1" />
                  Execute
                </Button>
              )}
            </div>
          )}

          {loading && <div className="text-xs text-muted-foreground">Loading...</div>}

          {result && (
            <div className="relative">
              <pre className="text-[11px] font-mono bg-zinc-900 text-zinc-300 p-3 rounded-lg overflow-auto max-h-60">
                {result}
              </pre>
              <button
                className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-zinc-800 text-zinc-400"
                onClick={() => navigator.clipboard.writeText(result)}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocsPage() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-base font-bold">🇮🇩 wilayah-id</h1>
            <Badge variant="secondary" className="text-[10px]">API v1</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/"><Button variant="ghost" size="sm" className="text-xs h-8">← Peta</Button></Link>
            <a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="h-8 w-8"><Github className="h-4 w-4" /></Button>
            </a>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="relative overflow-hidden">
        {/* Background gradient mesh */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50/50 via-background to-background dark:from-blue-950/20 dark:via-background dark:to-background" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-blue-500/10 dark:bg-blue-500/5 rounded-full blur-[100px] -z-10 pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-6">
          <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0 text-xs px-3 py-1 mb-2">
            API Documentation
          </Badge>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight">API Reference</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Base URL: <code className="bg-muted px-2 py-1 rounded-md font-mono text-sm border">/api/v1</code>
            <br />20 endpoints · Semua response dalam format JSON terstruktur
          </p>
          <div className="inline-block text-left mt-6">
            <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Response Format:</div>
            <code className="block font-mono bg-zinc-950 text-zinc-300 px-4 py-3 rounded-xl border border-zinc-800 shadow-xl text-xs sm:text-sm">
              {`{
  "status": "success",
  "data": [...],
  "meta": { "total": N }
}`}
            </code>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-20 space-y-16 mt-8">
        {/* Endpoint groups */}
        {ENDPOINT_GROUPS.map((group) => (
          <section key={group.category}>
            <div className="flex items-center gap-2 mb-4">
              <div className={`p-1.5 rounded-md ${group.bgColor}`}>
                <group.icon className={`w-4 h-4 ${group.color}`} />
              </div>
              <h3 className="text-lg font-bold">{group.category}</h3>
              <span className="text-xs text-muted-foreground">{group.endpoints.length} endpoints</span>
            </div>

            <div className="divide-y">
              {group.endpoints.map((ep) => (
                <EndpointRow key={ep.path} ep={ep} groupColor={group.color} />
              ))}
            </div>
          </section>
        ))}

        <Separator />

        {/* Vector tiles */}
        <section>
          <h3 className="text-lg font-bold mb-3">🗺️ Vector Tiles</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Mapbox Vector Tiles (MVT) di <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">/tiles/{"{layer}/{z}/{x}/{y}"}.pbf</code>
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              { layer: "provinsi", zoom: "z3–9", color: "border-l-blue-500" },
              { layer: "kabupaten", zoom: "z7–11", color: "border-l-purple-500" },
              { layer: "kecamatan", zoom: "z10–12", color: "border-l-emerald-500" },
              { layer: "desa", zoom: "z12–14", color: "border-l-amber-500" },
            ].map((t) => (
              <div key={t.layer} className={`border-l-2 ${t.color} pl-3 py-1`}>
                <div className="font-mono text-sm font-semibold">{t.layer}</div>
                <div className="text-xs text-muted-foreground">{t.zoom}</div>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="border-t bg-muted/20 pb-12">
        <div className="max-w-4xl mx-auto px-4 pt-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🇮🇩</span>
                <span className="font-bold text-lg bg-gradient-to-r from-blue-600 to-violet-600 dark:from-blue-400 dark:to-violet-400 bg-clip-text text-transparent">wilayah-id</span>
              </div>
              <p className="text-sm text-muted-foreground">
                REST API performa tinggi untuk data batas administrasi dan kode pos seluruh Indonesia.
              </p>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/docs" className="hover:text-foreground transition-colors">API Documentation</Link></li>
                <li><Link href="/self-host" className="hover:text-foreground transition-colors">Self-Hosting Guide</Link></li>
                <li><a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub Repository</a></li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="font-semibold text-sm">Data Sources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="https://github.com/Alf-Anas/batas-administrasi-indonesia" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Batas Administrasi (BIG)</a>
                </li>
                <li>
                  <a href="https://github.com/lokabisa-oss/region-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Kode Wilayah</a>
                </li>
                <li>
                  <a href="https://github.com/lokabisa-oss/postal-code-id" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Kode Pos</a>
                </li>
              </ul>
            </div>
          </div>
          <Separator className="mb-8" />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} wilayah-id. Open source (MIT License).</p>
            <div className="flex items-center gap-4">
              <a href="https://github.com/dhanyyudi" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Github className="w-3.5 h-3.5" /> dhanypedia
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
