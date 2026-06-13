import { readFileSync } from "node:fs";
import "dotenv/config";
import mysql from "mysql2/promise";
import { config } from "../config.js";

/**
 * Apply schema.sql, injecting the embedding model/dim. Idempotent (CREATE TABLE IF NOT EXISTS).
 * Connects without a default DB first so it can create the database, then USE it.
 */
export async function migrate(): Promise<void> {
  const { TIDB_HOST, TIDB_PORT, TIDB_USER, TIDB_PASSWORD, TIDB_DATABASE, TIDB_CA_PATH } = process.env;
  if (!TIDB_HOST || !TIDB_USER || !TIDB_PASSWORD) throw new Error("Missing TIDB_* in .env");
  const db = TIDB_DATABASE ?? "shiba";

  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8")
    .replaceAll("__EMBED_MODEL__", config.embedding.model)
    .replaceAll("__EMBED_DIM__", String(config.embedding.dimension));

  // Strip whole-line comments FIRST, then split on ';' — a naive split drops comment-led
  // statements (poc/tidb LEARNINGS). Inline trailing `-- ...` comments are valid SQL, kept.
  const statements = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "")) // strip whole-line AND inline comments (a `;` inside a comment must not split a statement; no `--` appears in our string literals)
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const ssl: mysql.SslOptions = { minVersion: "TLSv1.2" };
  if (TIDB_CA_PATH) ssl.ca = readFileSync(TIDB_CA_PATH);
  const conn = await mysql.createConnection({
    host: TIDB_HOST,
    port: Number(TIDB_PORT ?? 4000),
    user: TIDB_USER,
    password: TIDB_PASSWORD,
    ssl,
    multipleStatements: false,
  });
  await conn.query("CREATE DATABASE IF NOT EXISTS `" + db + "`");
  await conn.query("USE `" + db + "`");
  console.log(`migrate: ${db} (embed ${config.embedding.model} @ ${config.embedding.dimension})`);
  for (const stmt of statements) {
    const head = stmt.replace(/\s+/g, " ").slice(0, 64);
    try {
      await conn.query(stmt);
      console.log(`  ok  ${head}`);
    } catch (e) {
      // FULLTEXT index may already exist (no IF NOT EXISTS) — tolerate on re-run.
      const msg = (e as Error).message;
      if (/already exist/i.test(msg)) console.log(`  skip ${head} (exists)`);
      else {
        console.error(`  ERR ${head}\n      ${msg}`);
        throw e;
      }
    }
  }
  await conn.end();
  console.log("migrate: done.");
}
