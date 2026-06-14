import { readFileSync } from "node:fs";
import "dotenv/config";
import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;

/** Shared TiDB connection pool. TLS required; ids returned as strings (bigNumberStrings). */
export function getPool(): Pool {
  if (pool) return pool;
  const { TIDB_HOST, TIDB_PORT, TIDB_USER, TIDB_PASSWORD, TIDB_DATABASE, TIDB_CA_PATH } =
    process.env;
  if (!TIDB_HOST || !TIDB_USER || !TIDB_PASSWORD) {
    throw new Error("Missing TIDB_HOST / TIDB_USER / TIDB_PASSWORD in .env");
  }
  const ssl: mysql.SslOptions = { minVersion: "TLSv1.2" };
  if (TIDB_CA_PATH) ssl.ca = readFileSync(TIDB_CA_PATH);
  pool = mysql.createPool({
    host: TIDB_HOST,
    port: Number(TIDB_PORT ?? 4000),
    user: TIDB_USER,
    password: TIDB_PASSWORD,
    database: TIDB_DATABASE ?? "shiba",
    ssl,
    connectionLimit: 5,
    bigNumberStrings: true, // BIGINT/AUTO_RANDOM ids -> strings (avoid JS precision loss; PoC lesson)
    enableKeepAlive: true,
    keepAliveInitialDelay: 60_000, // hold the connection; helps serverless cold-start (91 §2.4-3)
  });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
