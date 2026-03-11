"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, Copy, Map, Database, Layers, 
  Globe, Code, Terminal, CheckCircle, ExternalLink,
  QrCode, FileCode
} from "lucide-react";

function CodeBlock({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-border/50 shadow-sm">
      <div className="flex items-center justify-between bg-muted/80 px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
        </div>
        <button 
          onClick={handleCopy} 
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <Copy className="w-3 h-3" />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="bg-zinc-950 text-zinc-300 text-xs font-mono p-4 overflow-x-auto">
        {children}
      </pre>
    </div>
  );
}

function ServiceCard({ 
  icon: Icon, 
  title, 
  description, 
  version, 
  features,
  color
}: { 
  icon: React.ElementType;
  title: string;
  description: string;
  version: string;
  features: string[];
  color: string;
}) {
  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg border-border/50">
      <CardHeader className="pb-4">
        <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{version}</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {features.map((feature, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function OGCPage() {
  const baseUrl = "https://wilayah-id-restapi.vercel.app/api/v1/ogc";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-base font-bold">🇮🇩 wilayah-id</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/docs">
              <Button variant="ghost" size="sm" className="text-xs h-8">API Docs</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 via-teal-500/5 to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-cyan-500/10 rounded-full blur-[100px] -z-10" />
        
        <div className="max-w-4xl mx-auto px-4 py-16 sm:py-20 text-center relative">
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            <Badge className="bg-emerald-500/10 text-emerald-600 border-0 text-xs px-3 py-1">
              <Globe className="w-3 h-3 mr-1" />
              OGC Compliant
            </Badge>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs px-3 py-1">
              ✅ Stable - QGIS/ArcGIS Ready
            </Badge>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500 bg-clip-text text-transparent">
              GIS Web Services
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-6">
            Integrasi langsung dengan <strong>QGIS, ArcGIS, MapInfo</strong>, dan software GIS lainnya 
            menggunakan standar OGC (Open Geospatial Consortium).
          </p>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 max-w-2xl mx-auto mb-6 text-left">
            <p className="text-sm text-emerald-800 dark:text-emerald-200">
              <strong>✅ Status: Stable.</strong> Layanan WMS/WFS kami didukung oleh database PostGIS on-premise yang sangat cepat,
              mengeliminasi masalah <em>timeout</em> saat merender data spasial kompleks. Sangat cocok untuk dihubungkan langsung ke QGIS atau ArcGIS Pro.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="#wms">
              <Button variant="outline" className="gap-2">
                <Map className="w-4 h-4" />
                WMS Service
              </Button>
            </Link>
            <Link href="#wfs">
              <Button variant="outline" className="gap-2">
                <Database className="w-4 h-4" />
                WFS Service
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pb-20 space-y-16">
        {/* Services Overview */}
        <section>
          <h2 className="text-xl font-bold mb-6 text-center">Available Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ServiceCard
              icon={Map}
              title="Web Map Service (WMS)"
              description="Layanan peta raster untuk visualisasi boundary administrasi Indonesia"
              version="1.3.0"
              color="bg-emerald-500"
              features={[
                "GetCapabilities - Metadata layanan",
                "GetMap - Render peta sebagai gambar",
                "GetFeatureInfo - Query atribut pada koordinat",
                "Support EPSG:4326 (WGS84)"
              ]}
            />
            <ServiceCard
              icon={Database}
              title="Web Feature Service (WFS)"
              description="Akses data vektor mentah dalam format GeoJSON dan GML"
              version="2.0.0"
              color="bg-cyan-500"
              features={[
                "GetCapabilities - Daftar feature types",
                "DescribeFeatureType - Schema data",
                "GetFeature - GeoJSON/GML output",
                "Filter dengan BBOX (bounding box)"
              ]}
            />
          </div>
        </section>

        {/* Quick Start Tabs */}
        <section>
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Code className="w-5 h-5" />
            Quick Start Guide
          </h2>

          <Tabs defaultValue="qgis" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="qgis">QGIS</TabsTrigger>
              <TabsTrigger value="arcgis">ArcGIS</TabsTrigger>
              <TabsTrigger value="code">Code/API</TabsTrigger>
            </TabsList>

            <TabsContent value="qgis" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Menambahkan WMS di QGIS
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">1</span>
                      <span>Buka QGIS → <strong>Layer</strong> → <strong>Add Layer</strong> → <strong>Add WMS/WMTS Layer</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">2</span>
                      <span>Klik <strong>New</strong> untuk membuat koneksi baru</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">3</span>
                      <span>Isi form:</span>
                    </li>
                  </ol>
                  <CodeBlock title="Connection Settings">
{`Name: wilayah-id WMS
URL: ${baseUrl}/wms`}
                  </CodeBlock>
                  <ol start={4} className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">4</span>
                      <span>Klik <strong>OK</strong>, lalu <strong>Connect</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">5</span>
                      <span>Pilih layer (provinsi, kabupaten, kecamatan, desa)</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">6</span>
                      <span>Klik <strong>Add</strong></span>
                    </li>
                  </ol>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Menambahkan WFS di QGIS
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">1</span>
                      <span>Buka QGIS → <strong>Layer</strong> → <strong>Add Layer</strong> → <strong>Add WFS Layer</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">2</span>
                      <span>Klik <strong>New</strong> untuk membuat koneksi baru</span>
                    </li>
                  </ol>
                  <CodeBlock title="Connection Settings">
{`Name: wilayah-id WFS
URL: ${baseUrl}/wfs`}
                  </CodeBlock>
                  <ol start={3} className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">3</span>
                      <span>Klik <strong>OK</strong>, lalu <strong>Connect</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">4</span>
                      <span>Pilih feature type (provinces, regencies, districts, villages)</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">5</span>
                      <span>Klik <strong>Add</strong> untuk menambahkan ke peta</span>
                    </li>
                  </ol>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="arcgis" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ArcGIS Pro</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">1</span>
                      <span>Buka <strong>Insert</strong> → <strong>Connections</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">2</span>
                      <span>Pilih <strong>New WMS Server</strong> atau <strong>New WFS Server</strong></span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">3</span>
                      <span>Masukkan URL layanan:</span>
                    </li>
                  </ol>
                  <CodeBlock title="Server URL">
{`WMS: ${baseUrl}/wms
WFS: ${baseUrl}/wfs`}
                  </CodeBlock>
                  <ol start={4} className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">4</span>
                      <span>Klik <strong>OK</strong> untuk menyimpan koneksi</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-medium">5</span>
                      <span>Tambahkan layer ke peta dari Catalog pane</span>
                    </li>
                  </ol>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="code" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code className="w-4 h-4" />
                    Contoh Penggunaan
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CodeBlock title="WFS GetFeature (cURL)">
{`# Get all provinces as GeoJSON
curl "${baseUrl}/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=provinces" \
  -H "Accept: application/geo+json"

# Get regencies in Jakarta area (with BBOX filter)
curl "${baseUrl}/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=regencies&BBOX=106.7,-6.4,107.0,-6.1" \
  -H "Accept: application/geo+json"

# WMS GetFeatureInfo
curl "${baseUrl}/wms?SERVICE=WMS&REQUEST=GetFeatureInfo&LAYERS=provinsi&QUERY_LAYERS=provinsi&BBOX=106.8,-6.3,107.0,-6.1&WIDTH=800&HEIGHT=600&X=400&Y=300&INFO_FORMAT=application/json"`}
                  </CodeBlock>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* REST API Alternative */}
        <section className="bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-violet-500/5 rounded-2xl p-8 border border-blue-500/10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Alternatif: REST API (Recommended)</h2>
              <p className="text-sm text-muted-foreground">Lebih stabil dan mudah digunakan</p>
            </div>
          </div>
          
          <p className="text-muted-foreground mb-6">
            Gunakan REST API jika Anda sedang membangun aplikasi web atau mobile modern yang membutuhkan 
            data batas wilayah dalam format GeoJSON murni, tanpa memerlukan software Desktop GIS (seperti QGIS/ArcGIS).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <CodeBlock title="All Provinces (GeoJSON)">
{`curl https://wilayah-id-restapi.vercel.app/api/v1/boundaries/provinces?geometry=true`}
            </CodeBlock>
            <CodeBlock title="Specific Province">
{`curl https://wilayah-id-restapi.vercel.app/api/v1/boundaries/provinces/31?geometry=true`}
            </CodeBlock>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/docs">
              <Button variant="outline" className="gap-2">
                <FileCode className="w-4 h-4" />
                Lihat API Documentation
              </Button>
            </Link>
            <a 
              href="https://wilayah-id-restapi.vercel.app/api/v1/boundaries/provinces?geometry=true" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="gap-2">
                <ExternalLink className="w-4 h-4" />
                Test Endpoint
              </Button>
            </a>
          </div>
        </section>

        {/* Full Docs Link */}
        <section className="text-center">
          <p className="text-muted-foreground mb-4">
            Butuh dokumentasi teknis lengkap?
          </p>
          <a 
            href="https://github.com/dhanyyudi/wilayah-id/blob/main/OGC_SERVICES.md" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            <Button variant="outline" className="gap-2">
              <FileCode className="w-4 h-4" />
              Lihat Dokumentasi Lengkap
              <ExternalLink className="w-3 h-3" />
            </Button>
          </a>
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t bg-muted/20">
        <div className="max-w-4xl mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Need help? Open an issue on <a href="https://github.com/dhanyyudi/wilayah-id" target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">GitHub</a></p>
        </div>
      </footer>
    </div>
  );
}
