-- Prisma: Interview retakes, Application list indexes
-- See docs/audit.md improvement plan (Section 9)

-- Order matches prisma migrate diff (attempt column + unique + indexes on Application, Interview)
ALTER TABLE "Interview" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "Interview_applicationId_interviewStepId_key";

CREATE UNIQUE INDEX "Interview_applicationId_interviewStepId_attempt_key" ON "Interview"("applicationId", "interviewStepId", "attempt");

CREATE INDEX "Application_createdAt_id_idx" ON "Application"("createdAt", "id");
CREATE INDEX "Application_status_id_idx" ON "Application"("status", "id");
CREATE INDEX "Application_status_candidateId_idx" ON "Application"("status", "candidateId");

-- DB-enforced application pipeline states (aligns with seed: new, screening, interviewing, offer, rejected)
ALTER TABLE "Application" ADD CONSTRAINT "application_status_check" CHECK (("status"::text = ANY (ARRAY['new'::text, 'screening'::text, 'interviewing'::text, 'offer'::text, 'rejected'::text])));

-- Fuzzy / substring phone search (docs/audit.md)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Candidate_phone_trgm_idx" ON "Candidate" USING gin (phone gin_trgm_ops);

-- Pre-aggregated read models for heavy dashboard queries (refresh after bulk ETL or on schedule)
CREATE MATERIALIZED VIEW "ApplicationStatusSummary" AS
SELECT "status", COUNT(*)::bigint AS n
FROM "Application"
GROUP BY "status";

CREATE UNIQUE INDEX "ApplicationStatusSummary_status_key" ON "ApplicationStatusSummary"("status");

CREATE MATERIALIZED VIEW "CompanyApplicationCount" AS
SELECT c."id" AS "companyId", c."name", COUNT(a."id")::bigint AS "applicationCount"
FROM "Company" c
LEFT JOIN "Position" p ON p."companyId" = c."id"
LEFT JOIN "Application" a ON a."positionId" = p."id"
GROUP BY c."id", c."name";

CREATE UNIQUE INDEX "CompanyApplicationCount_companyId_key" ON "CompanyApplicationCount"("companyId");

REFRESH MATERIALIZED VIEW "ApplicationStatusSummary";
REFRESH MATERIALIZED VIEW "CompanyApplicationCount";
