"use client";

import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { Moon, Sun, Github, Globe } from "lucide-react";
import Link from "next/link";

import { useState, useEffect } from "react";

export default function Navbar() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-12 flex items-center justify-between px-4 bg-background/80 backdrop-blur-md border-b">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold tracking-tight">
          🇮🇩 wilayah-id
        </span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Batas Administrasi Indonesia
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Link href="/ogc" prefetch={false}>
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" title="GIS Services">
            <Globe className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/ogc" prefetch={false}>
          <Button variant="ghost" size="sm" className="text-xs h-8 hidden sm:inline-flex">
            GIS Services
          </Button>
        </Link>
        <Link href="/docs" prefetch={false}>
          <Button variant="ghost" size="sm" className="text-xs h-8">
            API Docs
          </Button>
        </Link>
        <a
          href="https://github.com/dhanyyudi/wilayah-id"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Github className="h-4 w-4" />
          </Button>
        </a>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {mounted ? (
            resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )
          ) : (
            <div className="h-4 w-4 opacity-0" />
          )}
        </Button>
      </div>
    </nav>
  );
}
