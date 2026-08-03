import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getPublicOrigins } from "@/lib/public-config";

export function proxy(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/api/health") {
    return NextResponse.next();
  }

  const origins = getPublicOrigins();

  if (url.pathname.startsWith("/api/")) {
    return NextResponse.rewrite(
      new URL(`${url.pathname}${url.search}`, origins.api),
    );
  }

  if (url.pathname.startsWith("/tiles/")) {
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
