import { readFileSync } from "node:fs";
import "dotenv/config";
import mysql from "mysql2/promise";

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "tidbcloud_free/amazon/titan-embed-text-v2";
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024); // must match EMBED_MODEL's dimension
export const DB = process.env.TIDB_DATABASE ?? "shiba_poc"; // we create/use this (not a system db)

export async function getConn() {
  const { TIDB_HOST, TIDB_PORT, TIDB_USER, TIDB_PASSWORD, TIDB_CA_PATH } = process.env;
  if (!TIDB_HOST || !TIDB_USER || !TIDB_PASSWORD) {
    throw new Error("Set TIDB_HOST / TIDB_USER / TIDB_PASSWORD in .env");
  }
  const ssl: mysql.SslOptions = { minVersion: "TLSv1.2" }; // TiDB Cloud requires TLS
  if (TIDB_CA_PATH) ssl.ca = readFileSync(TIDB_CA_PATH);
  const conn = await mysql.createConnection({
    host: TIDB_HOST,
    port: Number(TIDB_PORT ?? 4000),
    user: TIDB_USER,
    password: TIDB_PASSWORD,
    ssl,
    multipleStatements: true,
  });
  // Connect without a default db, then create/select our PoC db (the .env one may be a system db).
  await conn.query("CREATE DATABASE IF NOT EXISTS `" + DB + "`");
  await conn.query("USE `" + DB + "`");
  return conn;
}

/** FTS_MATCH_WORD takes a CONSTANT string only (no placeholders) -> inline + escape (98 §6). */
export function ftsLiteral(s: string): string {
  // drop ASCII control chars (code point < 0x20) without a control-char regex literal, cap length
  const clean = [...s].filter((ch) => ch.codePointAt(0)! >= 0x20).join("").slice(0, 200);
  return `'${clean.replace(/'/g, "''")}'`; // escape single quotes for the SQL string literal
}

export function percentiles(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    min: r(s[0]),
    p50: r(at(0.5)),
    p95: r(at(0.95)),
    p99: r(at(0.99)),
    max: r(s[s.length - 1]),
  };
}
