import { Pool, QueryResultRow } from "pg";
import { neon } from "@neondatabase/serverless";

/**
 * Database connection factory — dual-mode.
 *
 * - Self-hosted PostGIS: uses standard `pg` Pool (TCP, persistent connections)
 * - Neon (Vercel): uses @neondatabase/serverless (HTTP, edge-compatible)
 *
 * Detection: if DATABASE_URL contains "neon.tech", uses Neon driver.
 * Otherwise, uses standard pg Pool.
 */

let pool: Pool | null = null;

function isNeonUrl(url: string): boolean {
  return url.includes("neon.tech");
}

function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * A query function type that supports both tagged template literals
 * and a .query() method for parameterized queries.
 */
export type DbQueryFunction = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<QueryResultRow[]>;
  query: (text: string, params?: unknown[]) => Promise<QueryResultRow[]>;
};

/**
 * Returns a query function compatible with both Neon and standard pg.
 *
 * Usage (tagged template):
 *   const sql = getDb();
 *   const rows = await sql`SELECT * FROM provinsi WHERE kode_prov = ${code}`;
 *
 * Usage (parameterized):
 *   const rows = await sql.query("SELECT * FROM provinsi WHERE kode_prov = $1", [code]);
 */
export function getDb(): DbQueryFunction {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  if (isNeonUrl(databaseUrl)) {
    // Neon serverless driver (HTTP) — for Vercel Edge/Serverless
    const neonSql = neon(databaseUrl);

    // Wrap to add .query() method
    const fn = async function sql(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<QueryResultRow[]> {
      return neonSql(strings, ...values) as Promise<QueryResultRow[]>;
    };

    fn.query = async (text: string, params?: unknown[]): Promise<QueryResultRow[]> => {
      // Neon supports raw query via sql.query-like approach
      // Use the neon function with raw query
      const result = await neonSql(text as unknown as TemplateStringsArray, ...(params || []));
      return result as QueryResultRow[];
    };

    return fn as DbQueryFunction;
  }

  // Standard pg Pool — for self-hosted PostGIS
  const pgPool = getPool();

  const fn = async function sql(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<QueryResultRow[]> {
    // Build parameterized query from template literal
    let query = "";
    for (let i = 0; i < strings.length; i++) {
      query += strings[i];
      if (i < values.length) {
        query += `$${i + 1}`;
      }
    }
    const result = await pgPool.query(query, values as unknown[]);
    return result.rows;
  };

  fn.query = async (text: string, params?: unknown[]): Promise<QueryResultRow[]> => {
    const result = await pgPool.query(text, params);
    return result.rows;
  };

  return fn as DbQueryFunction;
}
