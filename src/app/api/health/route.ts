import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "wilayah-id-web",
      version: packageJson.version,
      commit: process.env.APP_COMMIT_SHA ?? "unknown",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
