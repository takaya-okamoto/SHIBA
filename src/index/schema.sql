-- SHIBA derived index (TiDB). Rebuildable from Markdown via `reindex` (docs/91 §2.2, 101 §4).
-- __EMBED_MODEL__ / __EMBED_DIM__ are injected by migrate.ts from config.
-- Validated on TiDB Cloud Starter (Tokyo) by poc/tidb (auto-embed + FTS + entity-route).

-- Markdown chunks (text-route over notes). Auto-embedded; FTS for keyword route.
CREATE TABLE IF NOT EXISTS chunks (
  id           BIGINT PRIMARY KEY AUTO_RANDOM,
  file_path    VARCHAR(512) NOT NULL,
  heading      VARCHAR(512),
  content      TEXT NOT NULL,
  embedding    VECTOR(__EMBED_DIM__) GENERATED ALWAYS AS (EMBED_TEXT('__EMBED_MODEL__', content)) STORED,
  content_hash CHAR(32) NOT NULL,
  is_evergreen BOOL NOT NULL DEFAULT FALSE,
  noted_on     DATE,
  source_trust ENUM('owner','untrusted') NOT NULL DEFAULT 'owner', -- 98 §3.5
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  VECTOR INDEX idx_chunks_emb ((VEC_COSINE_DISTANCE(embedding)))
);

-- Structured facts (round-trip with the Markdown facts fence). The entity-route searches here.
CREATE TABLE IF NOT EXISTS facts (
  id            BIGINT PRIMARY KEY, -- app-assigned by reindex/extract (stable links, avoids AUTO_RANDOM)
  claim         VARCHAR(500) NOT NULL,
  kind          ENUM('event','preference','commitment','belief','fact') NOT NULL DEFAULT 'fact',
  confidence    FLOAT,
  valid_from    DATE,
  recorded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  state         ENUM('active','superseded','archived','deleted') NOT NULL DEFAULT 'active',
  superseded_by BIGINT,
  expired_at    DATETIME,
  generated_by  VARCHAR(16),                                          -- extraction/dream/summary (98 §3.1)
  source_trust  ENUM('owner','untrusted') NOT NULL DEFAULT 'owner',   -- laundering defense (98 §3.5)
  source_path   VARCHAR(512),
  row_num       INT,
  embedding     VECTOR(__EMBED_DIM__) GENERATED ALWAYS AS (EMBED_TEXT('__EMBED_MODEL__', claim)) STORED,
  VECTOR INDEX idx_facts_emb ((VEC_COSINE_DISTANCE(embedding)))
);

-- entities + fact<->entity hyperedges (101 §4). idx_fe_entity drives the entity-route.
CREATE TABLE IF NOT EXISTS entities (
  id            BIGINT PRIMARY KEY, -- app-assigned by reindex/extract
  slug          VARCHAR(255) NOT NULL UNIQUE,                          -- ^[a-z0-9_-]+$ (98 §6)
  name          VARCHAR(255) NOT NULL,
  kind          ENUM('person','org','place','topic','event','other') NOT NULL DEFAULT 'other',
  aliases       JSON,
  mention_count INT NOT NULL DEFAULT 0,
  last_seen     DATE
);

CREATE TABLE IF NOT EXISTS fact_entities (
  fact_id   BIGINT NOT NULL,
  entity_id BIGINT NOT NULL,
  role      VARCHAR(16),
  PRIMARY KEY (fact_id, entity_id),
  INDEX idx_fe_entity (entity_id)
);

-- Japanese full-text indexes (MULTILINGUAL parser). ⚠️ preview; SearchProvider keeps a LIKE fallback.
CREATE FULLTEXT INDEX idx_chunks_fts ON chunks (content) WITH PARSER MULTILINGUAL;
CREATE FULLTEXT INDEX idx_facts_fts ON facts (claim) WITH PARSER MULTILINGUAL;
