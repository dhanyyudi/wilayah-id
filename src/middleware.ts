import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPublicOrigins, getRuntimeRole } from "@/lib/public-config";

// Keep the legacy middleware convention while OpenNext requires Edge middleware.
export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/api/health") {
    return NextResponse.next();
  }

  const runtimeRole = getRuntimeRole();

  if (url.pathname.startsWith("/api/")) {
    if (runtimeRole === "origin") {
      return NextResponse.next();
    }

    const origins = getPublicOrigins();
    return NextResponse.rewrite(
      new URL(`${url.pathname}${url.search}`, origins.api),
    );
  }

  if (url.pathname.startsWith("/tiles/")) {
    const origins = getPublicOrigins();
    const tilePath = url.pathname.slice("/tiles".length);
    return NextResponse.rewrite(
      new URL(`${tilePath}${url.search}`, origins.tiles),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/tiles/:path*"],
};
