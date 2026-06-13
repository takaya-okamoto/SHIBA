-- SHIBA PoC schema — TiDB Cloud Starter (AWS Tokyo).
-- ⚠️ FTS = public preview, auto-embed = BYOK Gemini. If a statement errors, fix the
--    syntax per current TiDB docs and record the working form in ../../docs/LEARNINGS.md.
-- Run `pnpm smoke` FIRST to confirm these features work before applying this full schema.
-- The EMBED model is injected by apply-schema.ts from EMBED_MODEL (replaces __EMBED_MODEL__).

DROP TABLE IF EXISTS fact_entities;
DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS entities;

-- facts = the rows we search. claim is auto-embedded; FTS index on claim for keyword route.
CREATE TABLE facts (
  id           BIGINT PRIMARY KEY, -- explicit ids from the seeder (AUTO_RANDOM exceeds JS safe-int)
  claim        VARCHAR(500) NOT NULL,
  kind         ENUM('event','preference','commitment','belief','fact') NOT NULL DEFAULT 'fact',
  state        ENUM('active','superseded','archived','deleted') NOT NULL DEFAULT 'active',
  source_trust ENUM('owner','untrusted') NOT NULL DEFAULT 'owner',
  valid_from   DATE NULL,
  recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- auto-embed (BYOK Gemini), 1536-dim, materialized on insert.
  embedding    VECTOR(__EMBED_DIM__) GENERATED ALWAYS AS (EMBED_TEXT('__EMBED_MODEL__', claim)) STORED,
  -- HNSW cosine vector index. On Starter the TiFlash columnar replica is auto-provisioned.
  VECTOR INDEX idx_facts_emb ((VEC_COSINE_DISTANCE(embedding)))
);

-- Japanese full-text index (multilingual parser). ⚠️ verify parser name / syntax (preview).
CREATE FULLTEXT INDEX idx_facts_fts ON facts (claim) WITH PARSER MULTILINGUAL;

CREATE TABLE entities (
  id   BIGINT PRIMARY KEY, -- explicit ids from the seeder
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  kind ENUM('person','org','place','topic','event','other') NOT NULL DEFAULT 'other'
);

-- fact <-> entity many-to-many (fact = hyperedge, 101 §4). idx_fe_entity makes
-- "facts for entity X" a single index lookup (the entity-route).
CREATE TABLE fact_entities (
  fact_id   BIGINT NOT NULL,
  entity_id BIGINT NOT NULL,
  PRIMARY KEY (fact_id, entity_id),
  INDEX idx_fe_entity (entity_id)
);
