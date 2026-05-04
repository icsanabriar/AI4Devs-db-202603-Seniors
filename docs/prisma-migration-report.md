# Prisma ERD alignment — migration report

## ERD source

- **Mermaid ERD:** `docs/ERD.md`  
- **Entities in scope:** `COMPANY`, `EMPLOYEE`, `POSITION`, `INTERVIEW_FLOW`, `INTERVIEW_STEP`, `INTERVIEW_TYPE`, `CANDIDATE`, `APPLICATION`, `INTERVIEW` (plus pre-existing `Education`, `WorkExperience`, `Resume` in the app).

## Database analysis (dbhub + PostgreSQL)

**Before changes (source of truth):**

| Observation | Detail |
|-------------|--------|
| **Tables** | `Candidate`, `Education`, `WorkExperience`, `Resume`, `_prisma_migrations` |
| **Naming** | Prisma default PascalCase, camelCase column names (quoted in PostgreSQL) |
| **FKs** | `Education.candidateId`, `WorkExperience.candidateId`, `Resume.candidateId` → `Candidate.id` (`ON DELETE RESTRICT`, `ON UPDATE CASCADE`) |
| **Indexes** | PK + `Candidate_email_key`. **No** indexes on `candidateId` in child tables |
| **Size / risk** | All tables in the kB range (trivial for blocking DDL); `ANALYZE` / row stats not used for this pass |

**After alignment:**

| Observation | Detail |
|-------------|--------|
| **New tables** | `Company`, `Employee`, `InterviewType`, `InterviewFlow`, `InterviewStep`, `Position`, `Application`, `Interview` |
| **Indexes added** | FK and query-oriented indexes (see [Indexes added](#indexes-added-with-justification)) |
| **ERD + legacy** | `Candidate` retained and linked to `Application`; `Education` / `WorkExperience` / `Resume` **unchanged** in shape |

## Schema differences (current at start vs target ERD)

| Area | Before | Target (ERD) |
|------|--------|----------------|
| Organisation | No company/employee/position | `Company` → `Employee` / `Position` |
| Interview design | N/A | `InterviewFlow` → `InterviewStep` → `InterviewType`; `Position` 1:1 with `InterviewFlow` via `Position.interviewFlowId` (unique) |
| Pipeline | N/A | `Application` (candidate + position) → `Interview` (step + employee) |
| Legacy candidate profile | `Education`, `WorkExperience`, `Resume` | ERD has only core `CANDIDATE` fields — **kept** extra tables in DB and Prisma (no drop) |
| `Candidate` | No applications | `applications` relation to `Application` |

## Models added

- `Company` — `name`, audit `createdAt` / `updatedAt`
- `Employee` — `companyId`, `name`, `email`, `role`, `isActive`, audit fields
- `InterviewType` — `name` (unique), optional `description`, audit
- `InterviewFlow` — `description`, audit; optional 1:1 `position` back-reference
- `InterviewStep` — `interviewFlowId`, `interviewTypeId`, `name`, `orderIndex` (unique with `interviewFlowId`)
- `Position` — ERD field set + `Decimal(12,2)` salary range, `DATE` `applicationDeadline`, `TEXT` for long copy
- `Application` — `positionId`, `candidateId`, `applicationDate` (date), `status`, `notes`, audit
- `Interview` — `applicationId`, `interviewStepId`, `attempt` (1-based per scheduled step retry), `employeeId`, `interviewDate` (date), `result`, `score`, `notes`, audit

## Models updated

- **`Candidate`** — `applications Application[]`; composite index on `(lastName, firstName)` for name search
- **`Education`**, **`WorkExperience`**, **`Resume`** — `@@index([candidateId])` to align join patterns with new FK index strategy (tables small; no concurrent index path required this round)

## Relationships (Prisma / ERD)

- `Company` 1—N `Employee`, 1—N `Position`
- `Position` 1—1 `InterviewFlow` (enforced with `@unique` on `interviewFlowId` on `Position`)
- `InterviewFlow` 1—N `InterviewStep`; `InterviewType` 1—N `InterviewStep`
- `Position` 1—N `Application`; `Candidate` 1—N `Application` (`@@unique([positionId, candidateId])` — one application per pair)
- `Application` 1—N `Interview`; `InterviewStep` 1—N `Interview`
- `Employee` 1—N `Interview`
- `Candidate` 1—N `Education` / `WorkExperience` / `Resume` (unchanged)

## Normalization decisions

- **`InterviewType` as a table** instead of a PostgreSQL enum, so new types and descriptions can be added without enum rewrite migrations.
- **Status / `employmentType` / `result` as `VARCHAR`** in v1; promote to lookup tables or enums in a later phase if the catalog stabilizes.
- **1:1 `Position` ↔ `InterviewFlow`** as in the ERD: single owned flow per position via unique FK from `Position` to `InterviewFlow`.
- **No denormalized JSON** for relational data; long text in `TEXT` only where the ERD calls for free text.

## Indexes added (with justification)

| Index | Purpose |
|-------|---------|
| `Company_name_idx` | Filter/list by org name |
| `Employee_companyId_idx`, `Employee_email_idx` | FK and recruiter lookup by email |
| `Employee_companyId_email_key` (unique) | Stable identity of an employee per company (optional business rule) |
| `InterviewType_name_key` (unique) | Dedupe type labels |
| `InterviewStep` on `interviewFlowId`, `interviewTypeId` | Walk flow and join to type |
| `InterviewStep_interviewFlowId_orderIndex_key` (unique) | Stable ordering of steps in a flow |
| `Position_interviewFlowId_key` (unique) | 1:1 and FK support |
| `Position_companyId_idx`, `Position_status_isVisible_idx` | Company scope + pipeline / public listing style filters |
| `Application` on `positionId`, `candidateId`, `status` | Pipeline queries |
| `Application_positionId_candidateId_key` (unique) | Enforce one application per candidate per position |
| `Interview` on `applicationId`, `interviewStepId`, `employeeId`, `interviewDate` | Scheduling and joins |
| `Interview_applicationId_interviewStepId_attempt_key` (unique) | One row per **`(applicationId, interviewStepId, attempt)`**; **`attempt`** increments on step retakes (replaces obsolete two-column unique) |
| `Candidate_lastName_firstName_idx` | Directory-style search |
| `Education` / `Resume` / `WorkExperience` on `candidateId` | **Backfill of missing FK support** on pre-existing child tables |

**Post-migration fix:** `Position_interviewFlowId_idx` was dropped in favor of the unique index on the same column (see migration `20260427005517_drop_redundant_position_interviewflow_index`).

## Constraints added (FK, UNIQUE, NOT NULL)

- **Foreign keys** on all new relations with `onDelete: Restrict` / `onUpdate: Cascade` to match the existing child-table style on `Candidate`.
- **Uniques:** `Application(positionId, candidateId)`, `Interview(applicationId, interviewStepId, attempt)`, `InterviewStep(interviewFlowId, orderIndex)`, `Position(interviewFlowId)`, `InterviewType(name)`, `Employee(companyId, email)`.
- **NOT NULL:** Required scalar fields for new tables as in Prisma; optional long-form / salary fields left nullable to avoid backfill for empty networks.

## Migration risks (locks, rewrites, large tables)

- **This rollout:** only **new** `CREATE TABLE` and **new** `CREATE INDEX` on **new** data (empty) plus `CREATE INDEX` on **small, low-row** `Candidate` children. No `NOT NULL` added to old columns, no table drops, no blocking full rewrites of large tables.
- **If `Candidate` or children grow large before similar index work:** prefer `CREATE INDEX CONCURRENTLY` in a hand-authored migration (see [Manual SQL](#manual-sql-postgresql-specific)), outside Prisma’s default single-transaction migration for that step.

## Backfill plan

- **N/A** for this migration set (empty new tables; existing rows unchanged).  
- **Future:** if you add `NOT NULL` to nullable legacy columns, use: add column nullable → backfill in batches → set `NOT NULL` (per your checklist).

## Manual SQL (PostgreSQL-specific)

- **Not required** for the applied paths on current table sizes.  
- **For future high-traffic or large tables**, when adding secondary indexes in production:

  **`CREATE INDEX CONCURRENTLY` must not run inside a transaction.** Prisma Migrate wraps each migration in a **single** transaction by default, so the statement below **cannot** be pasted into a normal autogenerated migration: PostgreSQL will error with:
  
  `ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`

  Use one of: **(1)** a hand-authored migration that Prisma is configured to run **without** a transaction (for PostgreSQL this is a documented, opt-in no-transaction / non-transactional migration mode), **(2)** the same SQL executed **manually** (e.g. `psql` or an ops job) **outside** `prisma migrate`, or **(3)** a separate ops playbook while keeping schema truth aligned with a follow-up migration if needed. Do not treat `CONCURRENTLY` as a drop-in for routine `prisma migrate dev` output.

  **Companion migration SQL:** PostgreSQL DDL after the baseline ERD (including **`Interview.attempt`**, rewriting the Interview composite unique index to **`(applicationId, interviewStepId, attempt)`**, **`Application`** list indexes and status **`CHECK`**, **`pg_trgm`**, refreshable materialized views) lives in **`backend/prisma/migrations/20260427112000_audit_improvements/migration.sql`** — read that file when reconciling transactional limits with DDL here.

  ```sql
  -- This form is invalid inside Prisma’s default transactional migration. See warning above.
  CREATE INDEX CONCURRENTLY IF NOT EXISTS "MyTable_fkField_idx" ON "MyTable" ("fkField");
  ```

- **If you add enum-like columns later:** prefer new lookup tables or `VARCHAR` + check constraints, not raw PostgreSQL `ENUM`, unless the value set is truly frozen.

- **.env / `DATABASE_URL`:** the repo’s root `.env` may use `${…}` in `DATABASE_URL`; some loaders do not expand that. For Prisma CLI, use a **fully expanded** connection string in `DATABASE_URL` (or a dotenv that expands) so `migrate` and `db` commands resolve reliably.

## Rollback plan

1. **Application-level:** deploy previous app binary that does not use new tables.  
2. **Database (reverse of migrations, last applied first):**  
   - `20260427120100_widen_candidate_phone_address` — widens **`Candidate.phone`** / **`address`** and recreates **`Candidate_phone_trgm_idx`** (see **`migration.sql`**); reversing requires a deliberate down-migration.  
   - `20260427112000_audit_improvements` — adds **`Interview.attempt`**, redefines the Interview unique constraint, aggregates, **`pg_trgm`** on **`Candidate.phone`**, and related DDL (see **`migration.sql`**); reverse with hand-authored SQL aligned to those objects.  
   - `20260427005517_drop_redundant_position_interviewflow_index` — re-creating a non-unique `Position_interviewFlowId` index is optional; usually just leave as-is.  
   - `20260427005500_erd_alignment_postgres` — **only if** no production data: `DROP TABLE` in child-before-parent order: `Interview`, `Application`, `Position`, `InterviewStep`, `Employee`, `InterviewType`, `InterviewFlow`, `Company`, then `DROP INDEX` for added indexes on `Candidate` / child tables; **in production with data, use a controlled migration, not a blind drop.**  
3. **Prisma:** `prisma migrate resolve` to mark rolled-back migrations in `_prisma_migrations` if you hand-apply rollbacks to match a branch.

**Safety:** this report does **not** recommend `prisma migrate reset` in shared environments (forbidden in your brief).

## Validation checklist

- [x] `npx prisma format` (after schema edits)  
- [x] `npx prisma validate` (with `DATABASE_URL` set)  
- [x] `npx prisma generate`  
- [x] `npx prisma migrate dev` (baseline ERD, redundant-index drop, **`20260427112000_audit_improvements`**, **`20260427120100_widen_candidate_phone_address`**) — see `backend/prisma/migrations/`  
- [ ] Re-run with CI `DATABASE_URL` pointing to the same DB or a copy  
- [ ] Load seed data for one company, flow, position, and application, then run integration tests when API exists    

## Migration files (this repo)

| Directory | Name |
|----------|------|
| `backend/prisma/migrations/` | `20260425025907_setup` (initial) |
| `backend/prisma/migrations/` | `20260427005500_erd_alignment_postgres` (ERD tables + indexes + FKs) |
| `backend/prisma/migrations/` | `20260427005517_drop_redundant_position_interviewflow_index` |
| `backend/prisma/migrations/` | `20260427112000_audit_improvements` — authoritative DDL **`migration.sql`**: `Interview.attempt` + unique **`Interview_applicationId_interviewStepId_attempt_key`**, **`Application`** indexes / status **`CHECK`**, **`pg_trgm`** on **`Candidate.phone`**, materialized views (`ApplicationStatusSummary`, `CompanyApplicationCount`) |
| `backend/prisma/migrations/` | `20260427120100_widen_candidate_phone_address` — widen **`Candidate.phone`** / **`address`** (**`migration.sql`**); drops & rebuilds **`Candidate_phone_trgm_idx`** |
