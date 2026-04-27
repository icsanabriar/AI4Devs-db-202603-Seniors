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
