-- Widen Candidate.phone and Candidate.address (align with schema; safe for existing DBs)
-- GIN (pg_trgm) on phone from audit_improvements must be dropped before type change
DROP INDEX IF EXISTS "Candidate_phone_trgm_idx";

ALTER TABLE "Candidate" ALTER COLUMN "phone" SET DATA TYPE VARCHAR(32);
ALTER TABLE "Candidate" ALTER COLUMN "address" SET DATA TYPE VARCHAR(255);

-- Recreate phone fuzzy search index (see 20260427112000_audit_improvements)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Candidate_phone_trgm_idx" ON "Candidate" USING gin (phone gin_trgm_ops);
