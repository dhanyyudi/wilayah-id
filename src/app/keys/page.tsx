"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAbsolutePublicUrl } from "@/lib/public-config";
import { AlertTriangle, ArrowLeft, Copy, KeyRound, Terminal } from "lucide-react";

const publicClientEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

interface AccessPolicy {
  enforced: boolean;
  issuance: boolean;
  key_ttl_days: number;
  limits: {
    anonymous: { per_minute: number; heavy_per_minute: number };
    free_key: { per_minute: number; heavy_per_minute: number; per_day: number };
    key_creation_per_day: number;
  };
}

interface IssuedKey {
  key: string;
  key_id: string;
  expires_at: string;
}

const numberFormat = new Intl.NumberFormat("id-ID");

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
    >
      <Copy className="w-3 h-3" />
      {copied ? "Copied!" : label}
    </button>
  );
}

function CodeBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-border/50 shadow-sm">
      <div className="flex items-center justify-between bg-muted/80 px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
        </div>
        <CopyButton value={children} />
      </div>
      <pre className="bg-zinc-950 text-zinc-300 text-xs font-mono p-4 overflow-x-auto">
        {children}
      </pre>
    </div>
  );
}

export default function ApiKeysPage() {
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [label, setLabel] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);

  useEffect(() => {
    fetch("/api/keys")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: AccessPolicy } | null) => setPolicy(body?.data ?? null))
      .catch(() => setPolicy(null));
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, contact }),
      });
      const body = (await response.json()) as {
        data?: IssuedKey;
        error?: { code: string; message: string };
      };

      if (response.ok && body.data) {
        setIssued(body.data);
      } else if (response.status === 429) {
        setError(
          "Batas pembuatan API key untuk alamat ini sudah tercapai. Coba lagi besok.",
        );
      } else if (response.status === 503) {
        setError("Pembuatan API key belum diaktifkan di server ini.");
      } else {
        setError(body.error?.message ?? "API key tidak dapat dibuat.");
      }
    } catch {
      setError("Server tidak dapat dihubungi. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const provincesUrl = getAbsolutePublicUrl(
    "/api/v1/regions/provinces",
    publicClientEnvironment,
  );
  const keyPlaceholder = issued?.key ?? "API_KEY_ANDA";
  const limits = policy?.limits;
  const issuanceUnavailable = policy !== null && !policy.issuance;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-base font-bold">🇮🇩 wilayah-id</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/docs">
              <Button variant="ghost" size="sm" className="text-xs h-8">
                API Docs
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12 space-y-10">
        <div className="text-center space-y-4">
          <Badge className="bg-blue-500/10 text-blue-600 border-0 text-xs px-3 py-1">
            <KeyRound className="w-3 h-3 mr-1" />
            API Key
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight">Buat API Key</h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            API tetap bisa dipakai tanpa key. API key gratis menaikkan batas
            permintaan Anda dan diperlukan untuk mengakses MCP server.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Batas permintaan</CardTitle>
            <CardDescription>
              Endpoint berat mencakup WMS GetMap, WFS GetFeature, OGC API
              Features items, dan batas wilayah dengan{" "}
              <code className="text-xs">geometry=true</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {limits ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4 font-medium">Akses</th>
                      <th className="py-2 pr-4 font-medium">Umum</th>
                      <th className="py-2 pr-4 font-medium">Endpoint berat</th>
                      <th className="py-2 font-medium">Harian</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 pr-4">Tanpa key (per alamat IP)</td>
                      <td className="py-2 pr-4">
                        {numberFormat.format(limits.anonymous.per_minute)}/menit
                      </td>
                      <td className="py-2 pr-4">
                        {numberFormat.format(limits.anonymous.heavy_per_minute)}/menit
                      </td>
                      <td className="py-2 text-muted-foreground">Tidak ada</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4">API key gratis</td>
                      <td className="py-2 pr-4">
                        {numberFormat.format(limits.free_key.per_minute)}/menit
                      </td>
                      <td className="py-2 pr-4">
                        {numberFormat.format(limits.free_key.heavy_per_minute)}/menit
                      </td>
                      <td className="py-2">
                        {numberFormat.format(limits.free_key.per_day)}/hari
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Memuat batas permintaan…</p>
            )}
            {policy && !policy.enforced && (
              <p className="text-xs text-muted-foreground mt-3">
                Server ini belum mengaktifkan pembatasan permintaan.
              </p>
            )}
          </CardContent>
        </Card>

        {issued ? (
          <Card className="border-emerald-500/40">
            <CardHeader>
              <CardTitle>API key Anda</CardTitle>
              <CardDescription>
                Berlaku sampai{" "}
                {new Date(issued.expires_at).toLocaleDateString("id-ID", {
                  dateStyle: "long",
                })}
                . ID key: <code className="text-xs">{issued.key_id}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
                <code className="block text-xs font-mono break-all">{issued.key}</code>
                <CopyButton value={issued.key} label="Salin key" />
              </div>
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-4 rounded-xl">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm leading-relaxed">
                  Simpan key ini sekarang. Server tidak menyimpannya dan key
                  tidak dapat ditampilkan lagi. Jangan menaruhnya di kode
                  frontend atau repository publik.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Key baru</CardTitle>
              <CardDescription>
                Tanpa akun. Satu key per aplikasi memudahkan pencabutan bila
                bocor.
                {limits &&
                  ` Maksimal ${numberFormat.format(limits.key_creation_per_day)} key per hari untuk setiap alamat IP.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="key-label">Nama aplikasi</Label>
                  <Input
                    id="key-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Contoh: dashboard kecamatan"
                    minLength={3}
                    maxLength={60}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="key-contact">Kontak (opsional)</Label>
                  <Input
                    id="key-contact"
                    value={contact}
                    onChange={(event) => setContact(event.target.value)}
                    placeholder="Email, bila ingin dihubungi soal perubahan layanan"
                    maxLength={120}
                  />
                </div>
                {(error || issuanceUnavailable) && (
                  <p role="alert" className="text-sm text-destructive">
                    {error ?? "Pembuatan API key belum diaktifkan di server ini."}
                  </p>
                )}
                <Button type="submit" disabled={submitting || issuanceUnavailable}>
                  {submitting ? "Membuat…" : "Buat API key"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <section className="space-y-4">
          <h2 className="text-xl font-bold">Cara memakai</h2>
          <p className="text-sm text-muted-foreground">
            Kirim key di header <code className="text-xs">X-API-Key</code>. Klien
            GIS yang tidak bisa mengatur header dapat memakai parameter{" "}
            <code className="text-xs">api_key</code>.
          </p>
          <CodeBlock title="REST API">
{`curl -H "X-API-Key: ${keyPlaceholder}" \\
  ${provincesUrl}`}
          </CodeBlock>
          <p className="text-sm text-muted-foreground">
            Setiap respons menyertakan header{" "}
            <code className="text-xs">RateLimit-Limit</code>,{" "}
            <code className="text-xs">RateLimit-Remaining</code>, dan{" "}
            <code className="text-xs">RateLimit-Reset</code>. Bila batas
            terlampaui, server menjawab HTTP 429 dengan{" "}
            <code className="text-xs">Retry-After</code>.
            {policy && ` Key berlaku ${numberFormat.format(policy.key_ttl_days)} hari.`}
          </p>
        </section>
      </main>
    </div>
  );
}
