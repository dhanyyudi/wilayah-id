"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface LayerConfig {
  id: string;
  label: string;
  color: string;
  zoomRange: string;
}

const LAYERS: LayerConfig[] = [
  { id: "provinsi", label: "Provinsi", color: "#3b82f6", zoomRange: "z3–9" },
  { id: "kabupaten", label: "Kabupaten/Kota", color: "#a855f7", zoomRange: "z7–11" },
  { id: "kecamatan", label: "Kecamatan", color: "#22c55e", zoomRange: "z10–12" },
  { id: "desa", label: "Desa/Kelurahan", color: "#fbbf24", zoomRange: "z12–14" },
];

interface LayerPanelProps {
  visibility: Record<string, boolean>;
  onToggle: (layerId: string) => void;
}

export default function LayerPanel({ visibility, onToggle }: LayerPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={cn(
      "transition-all duration-200",
      collapsed ? "w-10" : "w-56"
    )}>
      {collapsed ? (
        <Button
          variant="secondary"
          size="icon"
          className="border shadow-md"
          onClick={() => setCollapsed(false)}
          title="Show layers"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      ) : (
        <Card className="shadow-lg border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Layers</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
          <CardContent className="px-3 pb-3 pt-0 space-y-2">
            {LAYERS.map((layer) => (
              <div
                key={layer.id}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0 border"
                    style={{ backgroundColor: layer.color, borderColor: layer.color }}
                  />
                  <Label
                    htmlFor={`layer-${layer.id}`}
                    className="text-xs truncate cursor-pointer"
                  >
                    {layer.label}
                  </Label>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{layer.zoomRange}</span>
                  <Switch
                    id={`layer-${layer.id}`}
                    checked={visibility[layer.id]}
                    onCheckedChange={() => onToggle(layer.id)}
                    className="scale-75"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
