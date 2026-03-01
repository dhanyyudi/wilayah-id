import { neon } from "@neondatabase/serverless";

/**
 * Creates a Neon SQL query function.
 * Uses @neondatabase/serverless for Vercel Edge/Serverless compatibility.
 *
 * Usage:
 *   const sql = getDb();
 *   const rows = await sql`SELECT * FROM provinsi`;
 */
export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(databaseUrl);
}
