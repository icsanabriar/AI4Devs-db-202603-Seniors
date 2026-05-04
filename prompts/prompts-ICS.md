# Prompts log

## Prompt - 2026-04-27T00:55:33Z
### Agent: Agent
#### Model: Composer 2

You are a senior database architect and Prisma migration specialist with deep expertise in PostgreSQL.

Your task is to convert a Mermaid ERD model (located in the `docs/ERD.md` file) into a production-ready Prisma schema and generate a safe migration for an existing PostgreSQL database.

---

## Context

- The ERD is defined in the `ERD.md` file inside the `docs` directory using Mermaid syntax.
- The target database engine is PostgreSQL.
- The database is already created.
- Cursor is configured with dbhub as an MCP server.

You must use dbhub to analyze the current database before making any design or migration decisions.

---

## Goals

1. Read and understand the Mermaid ERD from `/docs`.
2. Analyze the current PostgreSQL schema using dbhub.
3. Compare the ERD with the existing database.
4. Design a normalized, production-ready Prisma schema.
5. Generate safe, incremental migrations.
6. Ensure performance, scalability, and maintainability.

---

## Mandatory: Database Analysis

Before writing any schema:

Use dbhub to:

- List all tables, columns, and relationships
- Inspect indexes and constraints
- Identify large tables (high-risk for migrations)
- Review naming conventions
- Detect missing or inefficient indexes
- Understand table usage patterns (if available)

Treat the existing database as the source of truth.
Treat the ERD as the desired target state.

---

## PostgreSQL Constraints (Critical)

Follow PostgreSQL-safe migration practices:

### Table Locking
- Avoid operations that trigger full table locks.
- Minimize `ALTER TABLE` impact on large tables.

### Adding Columns
- Add new columns as NULLABLE first.
- Do not add defaults immediately if it causes table rewrites.

### NOT NULL Constraints
- Apply in phases:
  1. Add column as nullable
  2. Backfill data
  3. Add NOT NULL constraint

### Default Values
- Avoid setting defaults during column creation on large tables.
- Apply defaults after data backfill.

### Indexes
- Use `CREATE INDEX CONCURRENTLY` for large tables.
- Document manual SQL if Prisma does not support it.

### Renaming
- Use `ALTER TABLE RENAME COLUMN`
- Preserve compatibility using Prisma `@map` and `@@map`

### Dropping Columns or Tables
- Avoid unless absolutely necessary
- Only after:
  - Data migration
  - Validation
  - Explicit documentation

### Enums
- PostgreSQL enums are hard to modify.
- Prefer lookup tables if future changes are expected.

---

## Prisma Schema Requirements

- Maintain backward compatibility with the existing database
- Use:
  - `@id`, `@default`
  - `@unique`, `@@unique`
  - `@@index`
  - `@relation`
  - `@map`, `@@map`
- Use database-specific types when needed (`@db.*`)
- Add audit fields (`createdAt`, `updatedAt`) where appropriate
- Normalize data:
  - Extract repeated values
  - Avoid duplication
- Use explicit join tables for many-to-many relationships when needed
- Avoid unnecessary nullable fields

---

## Indexing Strategy

Indexes must be based on actual usage insights from dbhub.

- Index:
  - Foreign keys
  - Frequently queried fields
  - High-cardinality filters
  - Common composite query patterns
- Avoid redundant indexes
- Balance read performance vs write overhead

For large tables:
- Prefer concurrent index creation
- Document manual SQL if required

---

## Migration Strategy

Follow a safe, incremental approach:

### Standard Flow

1. Create new tables
2. Add new columns as nullable
3. Backfill data (in batches if needed)
4. Add indexes
5. Add constraints (NOT NULL, UNIQUE, FK)
6. Update application logic if required
7. Remove deprecated structures (final step)

### Large Tables

- Avoid blocking operations
- Use phased migrations
- Backfill data asynchronously if needed

### Forbidden Operations

- Do not use `prisma migrate reset`
- Do not drop tables or columns without explicit justification

---

## Normalization

- Aim for Third Normal Form (3NF) where practical
- Replace repeated text fields with:
  - enums (if stable)
  - lookup tables (if dynamic)
- Avoid:
  - duplicated attributes
  - misuse of JSON for relational data

---

## Deliverables

Generate:

1. Updated `schema.prisma`
2. Prisma migration files
3. Manual SQL (if required for PostgreSQL constraints)
4. Migration report

---

## Migration Report

Create or update:

`docs/prisma-migration-report.md`

Include the following sections:

| Section | Description |
|---|---|
| ERD Source | Path to Mermaid file |
| Database Analysis | Summary from dbhub |
| Schema Differences | Current vs target |
| Models Added | New models |
| Models Updated | Modified models |
| Relationships | Key relationships |
| Normalization Decisions | Design improvements |
| Indexes Added | With justification |
| Constraints Added | FK, UNIQUE, NOT NULL |
| Migration Risks | Locks, rewrites, large tables |
| Backfill Plan | Data migration approach |
| Manual SQL | PostgreSQL-specific commands |
| Rollback Plan | Safe rollback strategy |
| Validation Checklist | Post-migration checks |

---

## Validation

Run:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate dev --name erd-alignment-postgres
```

---
## Prompt - 2026-04-27T01:08:19Z
### Agent: Agent
#### Model: Composer 2

You are a senior database performance engineer and data validation specialist with deep expertise in PostgreSQL and Prisma.

Your task is to generate realistic test data, validate database performance, and produce a structured audit of the current data model using dbhub MCP.

## Context

- The database engine is PostgreSQL.
- The schema is implemented using Prisma.
- The model was recently derived from a Mermaid ERD.
- Cursor is configured with dbhub as an MCP server.

You must use dbhub to execute queries, analyze performance, and validate the behavior of the database under realistic conditions.

## Objectives

1. Generate realistic test data aligned with the Prisma schema.
2. Populate the database safely without compromising integrity.
3. Execute representative queries using dbhub MCP.
4. Measure and analyze performance.
5. Identify strengths and weaknesses in the data model.
6. Produce a structured audit report with scores and an improvement plan.

## Step 1: Schema Understanding

- Read the current `schema.prisma`.
- Identify:
  - Core entities
  - Relationships (1:1, 1:N, N:M)
  - High-cardinality tables
  - Critical business flows
- Detect:
  - Potential bottlenecks
  - Heavy join paths
  - Frequently queried fields

## Step 2: Test Data Generation

Generate realistic and scalable test data:

### Requirements

- Maintain referential integrity
- Respect constraints (FK, unique, NOT NULL)
- Use meaningful distributions (not random noise)

### Data Volume Strategy

Create at least 3 tiers:

- Small dataset (baseline validation)
- Medium dataset (typical usage)
- Large dataset (stress testing)

### Data Characteristics

- Include:
  - High-cardinality fields
  - Repeated query patterns
  - Edge cases (nulls, extremes, duplicates where allowed)
- Simulate real usage patterns:
  - Frequent reads
  - Writes
  - Updates

### Implementation

- Use Prisma seed scripts or SQL inserts
- Batch inserts to avoid performance issues
- Avoid locking large tables unnecessarily

## Step 3: Query Design (MANDATORY)

Using dbhub MCP, define and execute queries such as:

### Read Queries

- Simple lookups by ID
- Filtered queries (WHERE conditions)
- Sorted queries (ORDER BY)
- Pagination queries (LIMIT/OFFSET)
- Aggregations (COUNT, SUM, AVG)
- Complex joins across multiple tables

### Write Queries

- Inserts (single and batch)
- Updates on indexed vs non-indexed fields
- Deletes (controlled)

### Analytical Queries

- Reports
- Grouping (GROUP BY)
- Time-based queries

## Step 4: Performance Analysis

Using dbhub:

- Measure:
  - Query execution time
  - Index usage
  - Sequential scans vs index scans
  - Join performance
- Identify:
  - Slow queries
  - Missing indexes
  - Inefficient joins
  - Over-fetching or under-indexing
- Analyze:
  - Large table impact
  - Lock contention (if visible)

## Step 5: Model Audit

Evaluate the model across the following criteria:

| Criterion | Description |
|---|---|
| Schema Design | Clarity, structure, naming |
| Normalization | Proper data separation |
| Indexing | Coverage and effectiveness |
| Query Performance | Efficiency under load |
| Scalability | Behavior with large datasets |
| Data Integrity | Constraints and consistency |
| Flexibility | Ease of future changes |
| Maintainability | Simplicity and clarity |

Score each criterion from **1 (poor) to 10 (excellent)**.

## Step 6: Audit Report

Create or update the file:

`docs/audit.md`

### Report Structure

#### 1. Summary
- High-level findings
- Overall assessment

#### 2. Data Generation
- Volume used
- Strategy applied

#### 3. Query Analysis
- Types of queries tested
- Key observations

#### 4. Performance Findings
- Fast queries
- Slow queries
- Bottlenecks

#### 5. Strengths
- What works well in the model

#### 6. Weaknesses
- Design or performance issues

#### 7. Scoring Table

| Criterion | Score (1-10) | Notes |
|---|---|---|
| Schema Design | X | |
| Normalization | X | |
| Indexing | X | |
| Query Performance | X | |
| Scalability | X | |
| Data Integrity | X | |
| Flexibility | X | |
| Maintainability | X | |

#### 8. Final Score

- Compute the average score (2 decimal places)
- Example: **Final Score: 7.85 / 10**

#### 9. Improvement Plan

For each weakness:

- Describe the issue
- Propose a solution
- Define impact (low/medium/high)
- Suggest implementation steps

#### 10. Recommended Actions

- Prioritized list of improvements
- Quick wins vs long-term changes

## Validation

Ensure:

- Queries are executed via dbhub
- Results are consistent
- No destructive operations are performed
- Data integrity is preserved

## Important Rules

- Do not generate unrealistic or meaningless data
- Do not ignore existing constraints
- Do not perform destructive operations
- Base all conclusions on observed data (not assumptions)
- Justify every recommendation

## Final Output

Provide:

1. Summary of audit results
2. Path to generated test data scripts
3. Path to `docs/audit.md`
4. Final score
5. Top 3 critical issues
6. Top 3 recommended improvements

Focus on accuracy, clarity, and actionable insights.

---
## Prompt - 2026-04-27T03:20:05Z
### Agent: Agent
#### Model: Composer 2

You are a senior database refactoring specialist and performance engineer with deep expertise in PostgreSQL and Prisma.

Your task is to execute the improvement plan defined in `docs/audit.md`, apply the necessary database changes, and generate a new audit to validate that the data model and performance have improved.

---

## Context

- The database engine is PostgreSQL.
- The schema is managed using Prisma.
- A previous audit exists in `docs/audit.md`.
- The improvement plan is defined in **Section 9 (Improvement Plan)** of that document.
- Cursor is configured with dbhub as an MCP server.

You must use dbhub to validate performance improvements using real queries.

---

## Objectives

1. Read and understand the previous audit (`docs/audit.md`).
2. Extract and prioritize the improvement plan.
3. Apply the improvements safely to the database and Prisma schema.
4. Regenerate test data if needed.
5. Re-run performance validation using dbhub.
6. Generate a new audit report.
7. Compare results and confirm improvement in score and performance.

---

## Step 1: Analyze Previous Audit

- Read `docs/audit.md`.
- Extract:
  - Identified weaknesses
  - Improvement plan (Section 9)
  - Previous scores per criterion
  - Final score

- Classify improvements:
  - Quick wins
  - Structural changes
  - High-impact optimizations

---

## Step 2: Plan Execution Strategy

Before applying changes:

- Validate feasibility of each improvement
- Identify:
  - Breaking changes
  - Risk level (low, medium, high)
  - Dependencies between changes

- Define execution order:
  - Safe, incremental, PostgreSQL-friendly

---

## Step 3: Apply Improvements

Apply changes following PostgreSQL best practices:

### Schema Changes

- Update `schema.prisma`
- Apply:
  - Index improvements
  - Normalization fixes
  - Constraint adjustments
  - Relationship optimizations

### PostgreSQL Safety Rules

- Avoid full table locks
- Use phased migrations:
  1. Add nullable columns
  2. Backfill data
  3. Add constraints
- Use `CREATE INDEX CONCURRENTLY` for large tables (manual SQL if needed)
- Avoid destructive operations unless explicitly justified

### Data Migration

- Backfill data where required
- Ensure referential integrity
- Validate results after each step

---

## Step 4: Regenerate / Validate Test Data

- Reuse or regenerate test datasets:
  - Small
  - Medium
  - Large

- Ensure consistency with updated schema
- Maintain realistic distributions

---

## Step 5: Re-run Performance Tests

Using dbhub MCP:

- Execute the same or equivalent queries from the previous audit:
  - Read queries
  - Write queries
  - Analytical queries

- Measure:
  - Execution time
  - Index usage
  - Query plans
  - Join efficiency

---

## Step 6: Comparative Analysis

Compare:

- Before vs After:
  - Query performance
  - Index efficiency
  - Bottlenecks
  - Resource usage (if available)

- Identify:
  - Improvements achieved
  - Remaining issues
  - Regressions (if any)

---

## Step 7: Generate New Audit Report

Create or update:

`docs/audit-refactor.md`

### Report Structure

#### 1. Summary
- Overview of improvements applied
- General outcome

#### 2. Changes Applied
- List of implemented improvements
- Mapping to original plan

#### 3. Performance Comparison
- Before vs after metrics
- Key improvements

#### 4. Strengths (Updated)
- What improved significantly

#### 5. Remaining Weaknesses
- Issues still present

#### 6. Scoring Table (Updated)

| Criterion | Previous Score | New Score | Delta | Notes |
|---|---|---|---|---|
| Schema Design | X | X | +/- | |
| Normalization | X | X | +/- | |
| Indexing | X | X | +/- | |
| Query Performance | X | X | +/- | |
| Scalability | X | X | +/- | |
| Data Integrity | X | X | +/- | |
| Flexibility | X | X | +/- | |
| Maintainability | X | X | +/- | |

#### 7. Final Score Comparison

- Previous Score: X.XX / 10
- New Score: X.XX / 10
- Improvement: +X.XX

#### 8. Validation of Improvement

Explicitly confirm:

- Whether the score improved
- Whether performance improved
- Whether bottlenecks were reduced

#### 9. Additional Recommendations

- Further optimizations (if needed)
- Long-term improvements

---

## Validation

Ensure:

- Queries are executed using dbhub
- Results are based on real measurements
- No destructive operations were performed unintentionally
- Schema and data integrity are preserved

---

## Important Rules

- Follow PostgreSQL-safe migration practices
- Do not introduce regressions
- Justify every applied change
- Maintain backward compatibility when possible
- Base conclusions on measurable results

---

## Final Output

Provide:

1. Summary of improvements applied
2. Path to updated `schema.prisma`
3. Path to migration files (if created)
4. Path to `docs/audit-refactor.md`
5. Previous vs new final score
6. Top 3 improvements achieved
7. Any remaining critical issues

Focus on measurable improvement, safety, and clarity.

---
## Prompt - 2026-04-27T03:56:58Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@prompts/prompts-ICS.md` around lines 450 - 454, The third prompt entry under the heading "## Prompt - 2026-04-27T03:20:05Z" currently contains a paraphrase instead of the verbatim user prompt; replace the paraphrased body text with the original user prompt text or with the token "[REDACTED]" if the original is sensitive, preserving the exact entry-format lines "### Agent: Agent" and "#### Model: Composer 2" and keeping the timestamp header unchanged; ensure the replacement is the lone body for that entry (no added commentary) so the file prompts/prompts-ICS.md remains an accurate, append-only audit log as required by the entry-format guideline.

---
## Prompt - 2026-05-04T02:14:04Z
### Agent: Agent
#### Model: Composer 2

You are a **Senior Database Architect** with strong experience in TypeScript documentation, maintainability, test readability, and pre-merge quality checks.

## Context

The project uses CodeRabbit pre-merge checks, and one of the required checks is **Docstring Coverage**.

The goal is to improve docstring coverage **only for backend files that are currently modified or newly added according to Git**.

## Desired Outcome

Add or improve useful docstrings and inline documentation only in backend source and test files that appear as **modified or added** in `git diff --name-status main`.

The documentation must help CodeRabbit's **Docstring Coverage** check while preserving application behavior.

## Critical Scope Rule

You must document **only files returned by Git as modified or added** under:

```txt
backend/prisma
backend/src
```

Do **not** document every file in those folders.

Do **not** edit unmodified files.

Do **not** edit files outside the final candidate file list.

## Required Workflow

### 1. Build the candidate file list from Git

Before editing anything, run Git status and identify only files that are currently modified or added.

Use commands equivalent to:

```bash
git diff --name-status main
```

From the result, include only files with statuses that represent modified or added work, such as:

```txt
M
A
AM
MM
??
```

Only include files whose paths are inside:

```txt
backend/prisma/
backend/src/
```

Exclude:

- Deleted files
- Renamed files outside the target folders
- Unmodified files
- Files outside `backend/prisma` and `backend/src`
- Generated artifacts, build output, coverage output, or dependency folders

After building the candidate list, treat it as immutable for this task.

If the candidate list is empty, stop and report that there are no modified or added backend source/test files to document.

### 2. Print the candidate list before editing

Before making changes, output the exact candidate file list in the chat or task summary.

Example:

```txt
Files selected for docstring updates:
- backend/prisma/seed.ts
- backend/src/presentation/controllers/positionController.ts
- backend/src/application/services/positionCandidateService.ts
```

Then edit **only** those files.

### 3. Inspect only candidate files

Review only the files in the candidate list.

Identify public or important code elements that need docstrings, including:

- Exported functions
- Controllers
- Route handlers
- Services
- Domain/model methods
- Utility functions
- Test suites
- Test helpers
- Mock factories or fixtures
- Complex test setup logic
- Non-obvious assertions

Prioritize exported code, API flow code, and reusable test helpers.

## Documentation Rules

### Add meaningful docstrings

For TypeScript, prefer TSDoc-style comments:

```ts
/**
 * Retrieves all candidates currently in process for a given position.
 *
 * @param positionId - Numeric identifier of the position.
 * @returns Candidate application summaries including current step and average score.
 */
```

Docstrings should explain:

- What the function, class, module, or test suite does.
- The purpose of important parameters.
- The return value, when useful.
- Side effects, when relevant.
- Error or edge-case behavior, when relevant.
- Why a test setup, fixture, mock, or assertion exists when it is not obvious.

### Document tests appropriately

For test files, add documentation only where it improves readability.

Good targets include:

- Test suite purpose.
- Shared fixtures.
- Mock setup.
- Integration test assumptions.
- Non-obvious edge cases.

Example:

```ts
/**
 * Verifies the next interview attempt behavior across success,
 * validation, empty-state, and error scenarios.
 */
describe('getNextInterviewAttempt', () => {
  // ...
});
```

### Avoid noisy comments

Do not add comments that simply repeat the code.

Avoid low-value comments such as:

```ts
// Calls the function
// Returns the result
// Creates a variable
```

Every docstring or comment must explain intent, behavior, context, or an important edge case.

## Behavior Preservation

Do not change runtime behavior.

Do not refactor logic unless absolutely required to place documentation safely.

Do not change:

- API responses
- Routes
- Controller behavior
- Service logic
- Database queries
- Test expectations
- Test data semantics
- Package dependencies
- Configuration files

If a file needs behavior changes to pass tests, do not make those changes in this task. Report them as risks instead.

## Validation

After adding documentation, run only the relevant backend validation commands available in `backend/package.json`, such as:

```bash
npm test
npm run build
npm run lint
```

Use the exact scripts available in the project.

Fix formatting, linting, or TypeScript issues only if they were caused by the documentation changes and only inside the candidate files.

Do not fix unrelated failures in other files.

## Constraints

- Work only on modified or added files from `git status` under `backend/src` and `backend/tests`.
- Do not edit unmodified files.
- Do not edit `frontend/`.
- Do not edit root-level files.
- Do not edit backend docs, audits, API specs, configs, or package files as part of this task.
- Do not add dependencies.
- Do not disable CodeRabbit, lint rules, or coverage checks.
- If you discover an undocumented but unmodified file, do not edit it. Mention it as a remaining gap.

## Output Style

When finished, provide a concise summary with:

1. Candidate files selected from `git diff --name-status main`.
2. Files actually updated.
3. Types of docstrings or comments added.
4. Validation commands executed and results.
5. Files intentionally ignored because they were not modified or added.
6. Remaining documentation gaps or risks, if any.

Remember: the purpose of this task is not to document the entire backend. The purpose is to document only the backend source and test files that are already modified or newly added.

---
## Prompt - 2026-05-04T02:17:27Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In
`@backend/prisma/migrations/20260427005500_erd_alignment_postgres/migration.sql`
at line 161, The unique index "Application_positionId_candidateId_key" on
Application(positionId, candidateId) prevents re-applications; to fix, decide
intended behavior and either (A) relax the constraint by including an additional
discriminant in the unique key such as roundOrAttempt or attemptNumber (add
column and recreate the unique index to include it), or (B) support soft-deletes
by adding deletedAt and change the index to include deletedAt (or use a partial
index WHERE deletedAt IS NULL) so only active applications must be unique, or
(C) drop the unique index and enforce “no active duplicate” in application
service logic; if perpetual blocking was intentional, add a schema
comment/docstring describing that choice.

---
## Prompt - 2026-05-04T02:21:49Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@backend/prisma/schema.prisma` around lines 187 - 209, The Interview model
declares @@unique([applicationId, interviewStepId, attempt]) while attempt has a
default of 1, which will cause P2002 on retakes unless callers explicitly set
attempt; update the schema/model comment on Interview (near the attempt field)
to document the contract (callers MUST set attempt = max(existing attempts for
(applicationId, interviewStepId)) + 1), and add an application-level helper
(e.g., a repository function named getNextInterviewAttempt or
computeNextAttemptForInterview that queries existing Interviews by applicationId
and interviewStepId and returns max+1) and ensure all createInterview code paths
call that helper and set attempt before inserting to avoid the unique-constraint
error.

---
## Prompt - 2026-05-04T02:22:27Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@backend/prisma/seed.ts` around lines 17 - 20, The DATABASE_URL fallback logic
currently reads process.env.DATABASE_HOST while the file header documents
DB_HOST, and it interpolates DB_USER/DB_PASSWORD without URL-encoding; update
the code that synthesizes DATABASE_URL (the block that inspects rawUrl and sets
process.env.DATABASE_URL) to read host from process.env.DB_HOST (or adjust the
header to DATABASE_HOST consistently) and wrap user and password with
encodeURIComponent when building the postgresql://... string so reserved
characters are percent-encoded.

---
## Prompt - 2026-05-04T02:23:55Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@backend/prisma/schema.prisma` around lines 21 - 22, The Candidate.phone
column was widened to 32 chars but the validator in
backend/src/application/validator.ts still enforces the old local-only regex
(^(6|7|9)\d{8}$); update the phone validation logic (the phone validation
function / regex used in validateCandidate or validatePhone) to accept
international and formatted numbers consistent with the API spec — e.g., allow
E.164 and common formatting characters (leading +, digits, spaces, dashes,
parentheses) up to 32 characters, or replace the strict regex with one that
enforces max length and permitted characters rather than the old local-only
pattern. Ensure the same validator name (validateCandidate / validatePhone) is
updated so inputs accepted by the schema and api-spec.yaml pass application
validation.

---
## Prompt - 2026-05-04T02:27:20Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@backend/src/application/services/getNextInterviewAttempt.ts` around lines 4 -
17, getNextInterviewAttempt currently reads MAX(attempt) then returns +1, which
allows race conditions; change to perform the read+insert atomically or else
assign attempts in-memory before batching: either (A) move the logic into a
transaction that both computes the current max and inserts the new interview
row(s) inside Prisma.transaction and implement retry-on-unique-constraint around
interview.create (referencing getNextInterviewAttempt and
prisma.interview.create), or (B) when preparing createMany rows (see seed logic
that uses skipDuplicates), compute and reserve attempt numbers per
(applicationId, interviewStepId) in-memory so you never rely on MAX + 1 across
concurrent writers; ensure the unique constraint @@unique([applicationId,
interviewStepId, attempt]) cannot be violated by concurrent operations.

---
## Prompt - 2026-05-04T02:29:57Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@docs/prisma-migration-report.md` at line 25, The intra-doc anchors for the
two links are broken: update the link targets or the headings so they match.
Specifically, change the link texts `[Indexes added](`#indexes-added`)` and
`[Manual SQL](`#manual-sql`)` to point to the actual fragment identifiers
generated by the headings (e.g., `#indexes-added-with-justification` and
`#manual-sql-postgresql-specific`), or alternatively rename the headings
"Indexes added (with justification)" and "Manual SQL (PostgreSQL-specific)" to
simple titles that produce `#indexes-added` and `#manual-sql` fragments; pick
one approach and make both links/headers consistent.

---
## Prompt - 2026-05-04T02:31:01Z
### Agent: Agent
#### Model: Composer 2

Verify each finding against the current code and only fix it if needed.

In `@docs/prisma-migration-report.md` around lines 85 - 96, The report's
index/uniqueness section and migration list are out of date: replace references
to the old two-column Interview uniqueness
(`Interview_applicationId_interviewStepId_key` and `Interview(applicationId,
interviewStepId)`) with the current three-column key that includes attempt
(e.g., the unique constraint used in the schema/migration referencing
Interview.attempt), update the descriptive line to mention the attempt column,
and add the missing migration entries/directories
(`20260427112000_audit_improvements` and `widen_candidate_phone_address`) to the
migration list so the document matches backend/prisma/migrations/* (also ensure
the note about the migration SQL references the migration.sql in
`20260427112000_audit_improvements`).
