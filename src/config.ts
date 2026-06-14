import { existsSync, readFileSync } from "node:fs";
import "dotenv/config";
import { parse } from "yaml";

export interface Config {
  embedding: {
    provider: "tidb-auto" | "local";
    model: string;
    dimension: number;
  };
  search: {
    candidatesPerRoute: number;
    rrfK: number;
    limit: number;
    /** Recency-decay half-life in days for dated facts (event/commitment). */
    recencyHalfLifeDays: number;
    /** Toggle recency decay (evergreen kinds are always exempt). */
    decayEnabled: boolean;
  };
}

const defaults: Config = {
  embedding: {
    provider: (process.env.EMBED_PROVIDER as "tidb-auto" | "local") ?? "tidb-auto",
    model: process.env.EMBED_MODEL ?? "tidbcloud_free/amazon/titan-embed-text-v2",
    dimension: Number(process.env.EMBED_DIM ?? 1024),
  },
  search: {
    candidatesPerRoute: 40,
    rrfK: 60,
    limit: 20,
    recencyHalfLifeDays: 30,
    decayEnabled: true,
  },
};

/** Load config.yaml (behavior) merged over defaults. Secrets stay in .env (docs/92 §3). */
export function loadConfig(path = "config.yaml"): Config {
  if (!existsSync(path)) return defaults;
  const y = (parse(readFileSync(path, "utf8")) ?? {}) as Partial<Config>;
  return {
    embedding: { ...defaults.embedding, ...y.embedding },
    search: { ...defaults.search, ...y.search },
  };
}

export const config: Config = loadConfig();
