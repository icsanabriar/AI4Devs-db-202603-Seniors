# Post-refactor audit: schema improvements & performance validation

**Database:** PostgreSQL, schema managed with Prisma. **Measurements:** dbhub `execute_sql` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)` and `ANALYZE` on hot tables. **No destructive** operations (no `DROP`/`TRUNCATE` of business data; migration adds structure and pre-aggregated views only).

**Baseline reference:** `docs/audit.md` (version prior to this refactor). **Plan source:** `docs/audit.md` **Section 9 (Improvement plan)** and **Section 10 (Recommended actions)**.

---

## 1. Summary

The refactor implements **database-level** improvements from the prior audit: **composite B-tree indexes** on `Application` for keyset-friendly ordering, **row-level `CHECK`** on `Application.status`, **`Interview.attempt` + widened unique key** to allow retakes, **`pg_trgm` + GIN** on `Candidate.phone` for future fuzzy search, and **materialized views** for heavy dashboard-style aggregates. The seed now **`REFRESH MATERIALIZED VIEW`** for the two MVs so perf datasets stay consistent after loads.

**Outcome:** **Measured** improvements on the same data volume as the last audit: **~0.02 ms** reads from `ApplicationStatusSummary` vs **~2.96 ms** for a live `GROUP BY` (and **~11.5 ms** in the earlier audit for straight seq-scan aggregate); **~0.03 ms** for the company leaderboard via `CompanyApplicationCount` vs **~22.5 ms** for the ad hoc multi-join query; a **keyset-style** `WHERE (createdAt, id) < (…)` on `Application` using **`Application_createdAt_id_idx` ran in ~0.24 ms** vs **~2.2–5.6 ms** for large-`OFFSET` plans that still read ~8k+ index entries. The **qualitative** model score is **+0.81** on the 8-criterion mean (7.75 → 8.56 / 10).

**Operational note:** Any application that **writes** to `Application` or to paths that change company totals must run **`REFRESH MATERIALIZED VIEW`** (or a scheduled `REFRESH CONCURRENTLY` after adding a suitable unique index + ops playbook). The seed handles this; production should use a job or trigger strategy.

---

## 2. Changes applied (mapped to `docs/audit.md` Section 9)

| Original improvement | Implementation | Notes |
|----------------------|------------------|--------|
| Rollups for `GROUP BY` / top company reports | `ApplicationStatusSummary` and `CompanyApplicationCount` **materialized views** + `REFRESH` in seed | Read path replaces full fact-table group/hash for snapshots; data is **stale** until refresh |
| Keyset / ordering index | `@@index([createdAt, id])`, `@@index([status, id])`, `@@index([status, candidateId])` on `Application` | Keyset path measured with `Application_createdAt_id_idx` (backward scan + range) |
| Constrain `status` | `application_status_check` on `Application` for the five values used in seed | Invalid inserts fail at DB; Prisma still uses `String` + schema comment for discoverability |
| `Interview` retakes | `attempt` `Int` default `1`, `@@unique([applicationId, interviewStepId, attempt])` | Replaces the old 2-col unique; existing rows get `attempt = 1` |
| `pg_trgm` on phone | `CREATE EXTENSION pg_trgm` + GIN on `phone` | Index created; at **~8.4k** rows the planner may still **choose seq scan** for `%…%` until cost crosses threshold |
| Planner / covering index for status joins | `@@index([status, candidateId])` (plus existing `status` index) | Complements the earlier audit; verify per-API in CI with `EXPLAIN` |

**Not in scope as automated “CI”:** the audit’s suggestion to add **regression tests** in the pipeline; recommend adding those in the application repo as a follow-up.

**PostgreSQL safety:** new columns added with `DEFAULT` on `Interview` (no table rewrite of existing rows for `NOT NULL` with default in PG 11+ typical fast path), indexes created with standard `CREATE INDEX` (table sizes here are moderate). For **very large** `Application` in production, consider **`CREATE INDEX CONCURRENTLY`** in a hand-managed step and mark migration accordingly.

---

## 3. Performance comparison (measured, same DB after `ANALYZE`)

| Workload (description) | Before (from `docs/audit.md` §3) | After (dbhub, this run) | Notes |
|--------------------------|-----------------------------------|-------------------------|--------|
| `GROUP BY status` on all `Application` | ~**11.5 ms** (seq scan + hash) | **~2.96 ms** (planner: **index-only** scan on `Application_status_idx` + `GroupAggregate`) | Also benefits from new stats + slimmer plan; not solely MV |
| `SELECT` pre-aggregated **status** counts | (same as above if naïve SQL) | **~0.019 ms** (seq on tiny MV) | **Use MV** for read-mostly dashboards; **refresh** after writes |
| Company + position + application **COUNT** (ad hoc) | **~22.5 ms** | N/A re-run of identical mega-join in this pass; **MV** `CompanyApplicationCount` | **~0.031 ms** for `SELECT ... ORDER BY applicationCount` on MV |
| `ORDER BY id` + `LIMIT 50` **`OFFSET 8000`** | **~2.3 ms** (read ~**8050** rows) | **~2.19 ms** (same pattern) | **Offset cost unchanged**; mitigation is **keyset** API, not new indexes |
| `ORDER BY createdAt, id` + **`OFFSET 8000`** | (not in prior table) | **~5.57 ms** (index `Application_createdAt_id_idx`, still **walks** ~8050) | Same O(offset) issue |
| **Keyset** (range on `(createdAt,id)` from max id, `ORDER BY createdAt` DESC) | (not in prior table) | **~0.24 ms** (Index Scan **Backward** on `Application_createdAt_id_idx`, **50** rows) | **Demonstrates** intended replacement for large offsets |
| 4-way join + `status = interviewing` + `LIMIT 100` | **~1.4 ms** | **~0.51 ms** | Variance run-to-run; same plan family |
| `LIKE '%5550001%'` on `phone` | **~0.76 ms** (seq) | **~0.23 ms** (seq) | Still seq at this size; **GIN** ready for larger N / different `LIKE` shapes |

**Takeaway:** The largest **sustained** wins are (1) **materialized** dashboard reads, and (2) **keyset**-style access using `(createdAt, id)`; **offset** remains costly by design.

---

## 4. Strengths (updated)

- **Enforced** application status domain at the database (`CHECK`); invalid transitions caught early if anyone bypasses the app layer.
- **Retake-capable** interviews without dropping uniqueness entirely.
- **Composite indexes** align with listed access patterns; **keyset** demo shows **~0.2 ms** class latency vs multi-ms offset.
- **Reporting path** can avoid scanning all `Application` rows when MVs are acceptable and **refreshed**.
- **Scalable phone search** infrastructure (`pg_trgm` + GIN) in place before row counts grow.

---

## 5. Remaining weaknesses

- **Offset pagination** is still a footgun: indexes do not remove O(offset) work; product/API must **prefer keyset**.
- **Materialized views** are **stale** between refreshes; write-heavy products need a **refresh policy** (schedule, or incremental tables).
- **`LIKE` with leading `%`** at **current** N may not yet pick **GIN**; re-check `EXPLAIN` after 10–100× growth.
- **Status** remains a `String` in Prisma (CHECK in DB only); a future **Prisma `enum`** or `ApplicationStatus` table would tighten the client.

---

## 6. Scoring table (updated)

| Criterion | Previous | New | Delta | Notes |
|-----------|----------|-----|-------|--------|
| Schema Design | 8 | **8.5** | +0.5 | CHECK, MVs, field docs |
| Normalization | 8 | **8** | 0 | Unchanged; MVs are denorm read models |
| Indexing | 7 | **9** | +2 | Composite + trgm GIN |
| Query Performance | 8 | **9** | +1 | Measured on MV + keyset path |
| Scalability | 7 | **8.5** | +1.5 | Rollup + keyset index |
| Data Integrity | 9 | **9.5** | +0.5 | CHECK; retake key |
| Flexibility | 7 | **8.5** | +1.5 | `attempt` for retakes |
| Maintainability | 8 | **8.5** | +0.5 | MV refresh in seed; migration documented |

**Previous average (from `docs/audit.md` §7):** **7.75 / 10**  
**New average (mean of the eight “new” cells above):** **8.56 / 10**  
**Delta:** **+0.81**

---

## 7. Final score comparison

- **Previous score:** 7.75 / 10  
- **New score:** 8.56 / 10  
- **Improvement:** **+0.81**

---

## 8. Validation of improvement

| Question | Result |
|----------|--------|
| Did the **score** improve? | **Yes** (+0.81 mean). |
| Did **measured** performance improve for the targeted patterns? | **Yes** for **MV reads** and **keyset**-style access; **offset** not improved (expected). `GROUP BY` on live table improved in this run vs the prior **documented** number, partly due to planner + index-only path. |
| Were **bottlenecks** reduced? | **Read-mostly** dashboard aggregations: **strong yes**. **Write-path** and **offset** list APIs: **unchanged** / still require app patterns. |
| **Regressions**? | **None** observed: migration applied cleanly; `Interview` backfill is default `attempt = 1`; `CHECK` matches existing seed values. |

---

## 9. Additional recommendations

1. **Automation:** add a nightly or post-ETL job: `REFRESH MATERIALIZED VIEW CONCURRENTLY` (requires no long locks on read; needs **unique** indexes on MVs—already present on both).
2. **APIs:** document **keyset** cursors for `Application` list endpoints; stop exposing large `offset` in public APIs.
3. **Type safety:** consider Prisma `enum` or a `ApplicationStatus` table + FK in a follow-up (coordinate with any non-seeded rows).
4. **Monitoring:** log slow `Application` queries in production; compare `EXPLAIN` to the shapes in `docs/audit.md` and this file.
5. **Offset BY id vs BY (createdAt,id):** if product sorts by `id` only, keyset on `id` is simpler; align indexes with the **actual** `ORDER BY`.

---

## 10. Artifacts

| Item | Path |
|------|------|
| Prisma schema | `backend/prisma/schema.prisma` |
| Migration (indexes, CHECK, trgm, MVs) | `backend/prisma/migrations/20260427112000_audit_improvements/migration.sql` |
| Seed (MV refresh, `attempt` in interview rows) | `backend/prisma/seed.ts` |
| Prior audit | `docs/audit.md` |
| This report | `docs/audit-refactor.md` |

**Apply migrations in other environments:** `npx prisma migrate deploy` (with `DATABASE_URL` set and network to the DB).

---

## Prompts log compliance

A corresponding user prompt is appended to `prompts/prompts-ICS.md` (append-only) per project rules.
