"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Copy, MapPin, Building2, Hash, Mail, Landmark, Users, Home, Map } from "lucide-react";
import type { MapGeoJSONFeature } from "maplibre-gl";

export default function InfoPanel({
  feature,
}: {
  feature: MapGeoJSONFeature | null;
}) {
  // If feature is null, render nothing
  if (!feature) {
    return null;
  }

  const p = feature.properties;
  const layer = feature.source;

  const isProvinsi = layer === "provinsi";
  const isKabupaten = layer === "kabupaten";
  const isKecamatan = layer === "kecamatan";
  const isDesa = layer === "desa";

  const title = isDesa
    ? p.nama_desa
    : isKecamatan
      ? p.nama_kecamatan
      : isKabupaten
        ? p.nama_kabupaten
        : p.nama_provinsi;

  const code = isDesa
    ? p.kode_desa
    : isKecamatan
      ? p.kode_kec
      : isKabupaten
        ? p.kode_kab
        : p.kode_prov;

  const levelLabel = isDesa
    ? p.tipe_desa || "Desa"
    : isKecamatan
      ? "Kecamatan"
      : isKabupaten
        ? p.tipe || "Kabupaten"
        : "Provinsi";

  const levelColor = isDesa
    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
    : isKecamatan
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : isKabupaten
        ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
        : "bg-blue-500/15 text-blue-600 dark:text-blue-400";

  const areaKm2 = p.area_km2 ? parseFloat(p.area_km2).toLocaleString("id-ID", { maximumFractionDigits: 1 }) : null;

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatNumber = (num: string | number | undefined | null) => {
    if (!num) return "-";
    return parseInt(num.toString(), 10).toLocaleString("id-ID");
  };

  const renderStatRow = (icon: React.ReactNode, label: string, value: string | React.ReactNode) => (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-3.5 h-3.5 text-muted-foreground shrink-0 flex items-center justify-center">
        {icon}
      </div>
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="ml-auto font-medium text-right break-words">{value}</span>
    </div>
  );

  return (
    <div className="w-72 text-sm">
      {/* Header — pr-6 avoids overlap with MapPopup close button */}
      <div className="space-y-1.5 mb-3 pr-6">
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${levelColor}`}>
            {levelLabel}
          </Badge>
          {areaKm2 && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {areaKm2} km²
            </span>
          )}
        </div>
        <h3 className="text-base font-bold leading-tight">{title}</h3>
      </div>

      <Separator className="mb-3" />

      {/* Demographics Area */}
      {(p.jumlah_penduduk || p.jumlah_kk || p.kepadatan) && (
        <>
          <div className="space-y-2 mb-3">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Data Kependudukan
            </h4>
            
            {p.jumlah_penduduk && renderStatRow(<Users className="w-3 h-3" />, "Penduduk", `${formatNumber(p.jumlah_penduduk)} jiwa`)}
            {p.jumlah_kk && renderStatRow(<Home className="w-3 h-3" />, "Kartu Keluarga", `${formatNumber(p.jumlah_kk)} KK`)}
            {p.kepadatan && renderStatRow(<Map className="w-3 h-3" />, "Kepadatan", `${formatNumber(p.kepadatan)} jiwa/km²`)}
            {isDesa && p.jangkauan && renderStatRow(<MapPin className="w-3 h-3" />, "Jangkauan", p.jangkauan)}
          </div>
          <Separator className="mb-3" />
        </>
      )}

      {/* Administrative Subdivisions Area */}
      {(p.jumlah_kab || p.jumlah_kota || p.jumlah_kec || p.jumlah_desa || p.jumlah_kel) && (
        <>
          <div className="space-y-2 mb-3">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Wilayah Administratif
            </h4>
            
            {(p.jumlah_kab || p.jumlah_kota) && renderStatRow(<Building2 className="w-3 h-3" />, "Kab/Kota", `${parseInt(p.jumlah_kab || "0") + parseInt(p.jumlah_kota || "0")}`)}
            {p.jumlah_kec && renderStatRow(<MapPin className="w-3 h-3" />, "Kecamatan", formatNumber(p.jumlah_kec))}
            {(p.jumlah_desa || p.jumlah_kel) && renderStatRow(<Hash className="w-3 h-3" />, "Desa/Kelurahan", `${parseInt(p.jumlah_desa || "0") + parseInt(p.jumlah_kel || "0")}`)}
          </div>
          <Separator className="mb-3" />
        </>
      )}

      {/* Region ID */}
      <div className="space-y-2 mb-3">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
          Identitas Wilayah
        </h4>
        <div className="flex items-center gap-2 text-xs">
          <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Kode Wilayah</span>
          <code className="ml-auto font-mono text-xs font-semibold">{code}</code>
          <button
            onClick={() => copyCode(code)}
            className="p-0.5 rounded hover:bg-muted"
            title="Salin kode"
          >
            <Copy className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>

        {/* Parent hierarchy with their codes */}
        {(isDesa || isKecamatan) && p.nama_kecamatan && (
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Kecamatan</span>
            <span className="ml-auto font-medium text-right">
              {p.nama_kecamatan}
            </span>
            {p.kode_kec && (
              <code className="text-[10px] text-muted-foreground font-mono">{p.kode_kec}</code>
            )}
          </div>
        )}

        {(isDesa || isKecamatan || isKabupaten) && p.nama_kabupaten && (
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">{p.tipe || "Kabupaten"}</span>
            <span className="ml-auto font-medium text-right">
              {p.nama_kabupaten}
            </span>
            {p.kode_kab && (
              <code className="text-[10px] text-muted-foreground font-mono">{p.kode_kab}</code>
            )}
          </div>
        )}

        {!isProvinsi && p.nama_provinsi && (
          <div className="flex items-center gap-2 text-xs">
            <Landmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Provinsi</span>
            <span className="ml-auto font-medium text-right">
              {p.nama_provinsi}
            </span>
            {p.kode_prov && (
              <code className="text-[10px] text-muted-foreground font-mono">{p.kode_prov}</code>
            )}
          </div>
        )}

        {isProvinsi && (
          <div className="flex items-center gap-2 text-xs">
            <Landmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Provinsi</span>
            <span className="ml-auto font-medium">{p.nama_provinsi}</span>
          </div>
        )}
      </div>

      {/* Postal code */}
      {isDesa && p.kode_pos && (
        <>
          <Separator className="mb-3" />
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md mb-3">
            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Kode Pos</span>
            <code className="ml-auto font-mono text-sm font-bold">{p.kode_pos}</code>
            <button
              onClick={() => copyCode(p.kode_pos)}
              className="p-0.5 rounded hover:bg-muted"
              title="Salin kode pos"
            >
              <Copy className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
