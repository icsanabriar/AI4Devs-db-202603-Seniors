# Data model and query performance audit

**Tooling:** database introspection, row counts, and all `EXPLAIN (ANALYZE, BUFFERS)` measurements below were executed with **dbhub** MCP against the live PostgreSQL instance after a fresh **`ANALYZE`** to refresh planner statistics.

**Data:** Non-destructive `INSERT` seed runs only (`backend/prisma/seed.ts`); no `DELETE` / `TRUNCATE` / `DROP` as part of this work.

---

## 1. Summary

The Prisma schema matches a sensible recruitment domain: `Company` → `Employee` / `Position` (1:1 with `InterviewFlow`), `InterviewStep` and `InterviewType`, `Candidate` → `Application` → `Interview`. After loading three **tiered** synthetic datasets (small, medium, large with distinct `perf-{tier}` namespacing in emails and `InterviewType` labels), the largest child tables are **`Application` (~16.6k rows)** and **`Candidate` (~8.4k rows)** in this environment, with pre-existing or earlier rows still present in `Candidate` totals.

**Overall:** At this scale, end-to-end join queries and targeted filters return in **&lt; 25 ms** on observed hardware. **Full-relation** aggregates (`GROUP BY` over all applications, company application volume) use **sequential scans** and cost **~11–23 ms** today—acceptable here but the dominant pattern to watch as row counts head toward millions.

**Assessment:** The model is **integrity-strong** and **index-aware** for foreign keys. Main risks are **scale-up patterns** (offset pagination, dashboard aggregates, and planner choice when filtering by `status` in complex joins) rather than current hot-path failures.

---

## 2. Data generation

| Tier | Config (see `seed.ts`) | Observed batch counts (this run) |
|------|------------------------|----------------------------------|
| **Small** | 2 co × 4 emp, 2 pos/co, 3 steps, 20 candidates | 2 companies, 8 employees, 4 positions, 20 candidates, 23 applications, 13 interviews (batch key `perf-small`) |
| **Medium** | 5 × 10 emp, 4 pos/co, 3 steps, 400 candidates | 5 / 50 / 20 / 400 / 596 / 307 (`perf-medium`) |
| **Large** | 15 × 25 emp, 8 pos/co, 4 steps, 8 000 candidates | 15 / 375 / 120 / 8 000 / 15 985 / 8 052 (`perf-large`) |

**Strategy:** Deterministic LCG prng, unique emails `cand.perf-{tier}.{n}@example.com`, `InterviewType` namespaced per tier to satisfy `@@unique([name])`, one `Position` per `InterviewFlow` (ERD 1:1), `createMany` in chunks, **`skipDuplicates`** for idempotent re-runs, **no** mass deletes.

**Post-load:** `ANALYZE` was executed once so `EXPLAIN` reflects realistic statistics.

**Actual high-water counts (measured, post-seed, via dbhub):**

| Table        | Count |
|-------------|-------|
| Application | 16 604 |
| Candidate   | 8 420 |
| Interview   | 8 372 |
| Company     | 22 |
| Position    | 144 |
| Employee    | 433 |

---

## 3. Query analysis (dbhub)

Representative workload classes exercised:

| Class | Query shape | Intent |
|-------|-------------|--------|
| **Read** | 4-table join: `Application` → `Candidate`, `Position`, `Company` with `WHERE status = 'interviewing' LIMIT 100` | Realistic “pipeline / inbox” |
| **Read** | `ORDER BY id LIMIT 50 OFFSET 8000` on `Application` | Classic offset pagination (stress) |
| **Analytical** | `GROUP BY status` on all `Application` | Status distribution (full table) |
| **Read** | `WHERE positionId = 3 AND status = 'interviewing' LIMIT 200` | Bitmap `AND` of position + status |
| **Read** | `Candidate` `WHERE phone LIKE '%5550001%'` (leading wildcard) | Unindexed free-text (expected seq scan) |
| **Analytical** | `Company` ← `Position` ← `Application`, `COUNT`, `ORDER BY count DESC`, `LIMIT 15` | Leadership dashboard |

**Write path:** Seeding used batched `INSERT` via Prisma; no timed `UPDATE`/`DELETE` in this audit to avoid mutating user data outside the seed contract.

**Key observations (from `EXPLAIN (ANALYZE, BUFFERS)` text returned by dbhub):**

- **4-way join + status + limit (100 rows, ~1.4 ms execution):** Planner used an **index scan on `Application` (`Application_candidateId_idx`)** merged to `Candidate`, then **primary-key lookups** on `Position` and `Company` with **Memoize** for repeated keys. The **`status = 'interviewing'`** predicate was applied as a **filter** on the index result (not a pure `Application_status_idx`-only access for this plan shape at this selectivity), yet latency stayed low at current cardinality.
- **Status + `positionId` (bitmap heap, ~0.15 ms):** **`BitmapAnd`** of **`Application_positionId_candidateId_key`** (bitmap on `positionId` slice) and **`Application_status_idx`**—shows **both** targeted indexes are used together when the query includes those predicates.
- **Offset 8000 / limit 50 (index on PK, ~2.3 ms):** `Index Scan` on **`Application_pkey`** but must **walk / skip** to the offset; plan reported **~8 050 rows** considered before the `Limit` – classic **O(offset + limit)** cost that **grows** with offset at large scale.
- **Global `GROUP BY status` (~11.5 ms):** **Sequential scan** of `Application` then hash aggregate – expected for “report over entire table” with only five status buckets at this size; **will grow linearly** with `Application` size unless pre-aggregated.
- **Phone substring (~0.76 ms, seq scan, ~1k rows touched before `LIMIT 50`):** **No** supporting index; leading `%` in `LIKE` prevents B-tree use—acceptable for ad hoc; **intentional** product search would need **trigram (pg_trgm)** or **normalized** phone + equality.
- **Company application totals (~22.5 ms):** **Two hash joins** over **full** `Application` and `Position` plus small `Company` – dominated by **building counts over all applications**; same scalability note as the status aggregate.

---

## 4. Performance findings

**Fast in this test**

- **Primary-key and FK-driven joins** at ~16k `Application` rows (sub-2 ms for limited joins, sub-0.2 ms for selective bitmap queries).
- **Selective** `positionId` + `status` filters using **bitmap** combination of existing indexes.

**Slower (still ms-scale here, but structural)**

- **Full-table aggregates** and **“top companies by volume”** reports (~11–23 ms) due to **seq scan** / hash over **all** `Application` rows.
- **Large `OFFSET` pagination** (reads ~offset + limit rows on PK scan).
- **Arbitrary `LIKE` on phone** without trigram: seq scan; acceptable volume today.

**Bottlenecks (at higher scale, not yet painful)**

- **Application** as the fact table: every dashboard over “all time” will scale with **O(N)** in `Application` unless **rolled up** (materialized view, daily counters, or CQRS read models).
- **Keyset / cursor** pagination not yet used in the schema; **OFFSET** is the anti-pattern to replace for “infinite scroll” on large result sets.
- **Composite filter** (e.g. `status` in a join) may or may not use `Application_status_idx` depending on the rest of the join graph—worth verifying per critical API with `EXPLAIN` in CI or query logs.

**Locking:** Not directly observable from `EXPLAIN`; seeding used app-level batches; no long-running `ALTER` in this test.

---

## 5. Strengths

- **Clear separation** of `InterviewType` (lookup), `InterviewFlow` / `InterviewStep` (recipes), and runtime `Interview` (instances).
- **Referential coverage:** FKs on all new relations, plus **sensible** `@@index` on FK columns and **composite uniques** (`Application` per pair, `Interview` per app+step).
- **Observed in plans:** `Application_status_idx` and unique `(positionId, candidateId)` used in real bitmap plans.
- **Idempotent, tiered** seed for repeatable perf experiments without destructive reset.

---

## 6. Weaknesses

- **String** `status` / `result` on hot paths: flexible but no DB-enforced value set; typos and **migration** of values are operational risks.
- **`@@unique([applicationId, interviewStepId])` on `Interview`:** rules out a **second attempt** for the same step (documented in the migration report).
- **Dashboard queries** that scan **all** `Application` rows will not stay “cheap” as N grows, even with indexes.
- **`OFFSET`** pagination for large pages will degrade; **keyset** not modeled (e.g. no `(createdAt, id)` composite index for common sort orders).

---

## 7. Scoring table

| Criterion | Score (1-10) | Notes |
|-----------|----------------|-------|
| Schema Design | 8 | Coherent ERD mapping; string enums on facts add ops overhead |
| Normalization | 8 | 3NF-style split; `InterviewType` as table vs PG enum (good) |
| Indexing | 7 | Strong FK and status; add composite/ordering indexes when query paths stabilize |
| Query Performance | 8 | Sub-ms to low-ms at ~16k apps; full scans acceptable only while N is small |
| Scalability | 7 | Fact-table growth and OFFSET/report queries need patterns beyond raw indexes |
| Data Integrity | 9 | Uniques and FKs match business rules; optional retakes blocked by `Interview` unique |
| Flexibility | 7 | `Interview` unique pair + string statuses limit evolution without care |
| Maintainability | 8 | Prisma + clear relation names; add enum or lookup tables to reduce “magic” strings |

---

## 8. Final score

**Final score: 7.75 / 10** (arithmetic mean of the eight criteria above, rounded to two decimals).

---

## 9. Improvement plan

| Weakness | Proposed solution | Impact | Suggested steps |
|----------|-------------------|--------|-----------------|
| Full-table `GROUP BY` / top-N company reports on `Application` | **Rollups:** daily `Application` counts per `company`/`position` in a **materialized table** or **materialized view** refreshed by job or on write | **High** (at large N) | 1) Define grain (day, company, status) 2) `REFRESH` strategy 3) Point dashboards at rollup |
| `OFFSET` pagination on `Application` | **Keyset** pagination: `WHERE (createdAt, id) &lt; ($cursor, $id)` (or &gt; for next page) with **index** `(createdAt, id)` or sort-aligned composite | **High** (long lists) | 1) Add composite index matching sort 2) Change API 3) Deprecate offset |
| `status` as unconstrained `VARCHAR` | **`CHECK`** constraint in DB or **lookup table** with FK; or Prisma + application-level enum with migration discipline | **Medium** | 1) Inventory allowed values 2) `ALTER` add check 3) Backfill 4) Tighten app |
| `Interview` blocks retakes for same step | If product needs retries: add **`attempt`**, drop unique on `(applicationId, interviewStepId)` or replace with `(applicationId, interviewStepId, attempt)` | **High** (product) | 1) Confirm product rule 2) Data migration 3) Schema change 4) App logic |
| Phone / fuzzy search | **`pg_trgm` GIN** index on `phone` or E.164 column + **exact** index | **Low–medium** (depends on feature) | 1) Enable extension 2) Index 3) Normalize input |
| Planner variance on “status in join” | Capture **regression** tests with **`EXPLAIN`** for top 5 API queries in CI; consider **covering** index `(status, candidateId)` or similar only if proven | **Medium** | 1) Log slow queries 2) A/B `EXPLAIN` 3) Add index **only** if justified |

---

## 10. Recommended actions (prioritized)

**Quick wins**

1. **Document** the highest-traffic read paths and run **`EXPLAIN (ANALYZE)`** in staging on each release (catch index regressions).
2. **Replace** large `OFFSET` in APIs with **keyset** where lists can exceed a few pages.
3. **Run `ANALYZE`** after bulk loads in production (or auto-vacuum tuning)—already shown to matter for `reltuples` accuracy.

**Longer term**

1. **Rollup / summary** table or materialized view for **KPIs** and **funnel** metrics over `Application` / `Interview`.
2. **Constrain** `status` and similar dimensions (check or reference table).
3. Revisit **`Interview` uniqueness** if retakes or parallel panels are in scope; otherwise keep and enforce in app copy.

---

## 11. Validation checklist

- [x] **dbhub** used for all measurements in this report (counts, `ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)`).
- [x] **No destructive** DDL/DML in the audit (insert-only seed, optional re-run idempotency through `skipDuplicates` and unique emails).
- [x] **Integrity:** seed respects FK order and unique pairs; re-seed of same tier skips duplicate `Candidate` while still idempotent for apps/interviews.
- [ ] Re-run the same `EXPLAIN` set after a **10×** or **100×** data increase (or on production clone) to validate trends.

---

## 12. Artifact locations

| Artifact | Path |
|----------|------|
| Prisma schema | `backend/prisma/schema.prisma` |
| Tiered seed script | `backend/prisma/seed.ts` |
| npm scripts | `backend/package.json` — `prisma:seed:small` / `medium` / `large` |
| This audit | `docs/audit.md` |

**Run seed (from `backend/`, with a resolved `DATABASE_URL`):**

```bash
SEED_TIER=small  npx prisma db seed
SEED_TIER=medium npx prisma db seed
SEED_TIER=large  npx prisma db seed
```

---

## Summary for stakeholders

1. **Audit results:** Model is **sound** and **measured** fast at ~16k applications; main future risk is **reporting and pagination** at scale, not current FK join speed.
2. **Test data script:** `backend/prisma/seed.ts` (+ `package.json` `prisma.seed`).
3. **Report file:** `docs/audit.md`.
4. **Final score:** **7.75 / 10**
5. **Top 3 critical issues:** (1) **Fact-table** reporting without rollups, (2) **OFFSET** pagination on growing lists, (3) **`Interview` uniqueness** vs product need for retakes.
6. **Top 3 improvements:** (1) **Summary / materialized** metrics, (2) **Keyset** pagination + supporting indexes, (3) **Constrain** or normalize **status** / domain strings.
