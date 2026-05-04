/**
 * Realistic, tiered test data for performance / validation runs.
 * Run:  SEED_TIER=small|medium|large  npx prisma db seed
 * Env:  DATABASE_URL (full URL) or root .env DB_USER/DB_PASSWORD/DB_NAME/DB_PORT
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { getNextInterviewAttempt } from "../src/application/services/getNextInterviewAttempt";
import { config } from "dotenv";
import * as path from "path";
import * as fs from "fs";

config({ path: path.join(__dirname, "../.env") });
const rootEnv = path.join(__dirname, "../../.env");
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const rawUrl = process.env.DATABASE_URL ?? "";
if (rawUrl.includes("${") && process.env.DB_USER) {
  process.env.DATABASE_URL = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DATABASE_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME}`;
}

const prisma = new PrismaClient();

type SeedTier = "small" | "medium" | "large";

const TIER = (process.env.SEED_TIER as SeedTier) || "small";
if (!["small", "medium", "large"].includes(TIER)) {
  throw new Error(`SEED_TIER must be small|medium|large, got: ${TIER}`);
}

/** Volume and shape of generated entities per `SEED_TIER` (companies, steps, candidates, etc.). */
const SPECS: Record<
  SeedTier,
  {
    companies: number;
    employeesPerCompany: number;
    positionsPerCompany: number;
    stepsPerFlow: number;
    candidates: number;
    avgAppsPerCandidate: number;
    shareWithInterview: number;
  }
> = {
  small: {
    companies: 2,
    employeesPerCompany: 4,
    positionsPerCompany: 2,
    stepsPerFlow: 3,
    candidates: 20,
    avgAppsPerCandidate: 1.2,
    shareWithInterview: 0.6,
  },
  medium: {
    companies: 5,
    employeesPerCompany: 10,
    positionsPerCompany: 4,
    stepsPerFlow: 3,
    candidates: 400,
    avgAppsPerCandidate: 1.5,
    shareWithInterview: 0.55,
  },
  large: {
    companies: 15,
    employeesPerCompany: 25,
    positionsPerCompany: 8,
    stepsPerFlow: 4,
    candidates: 8000,
    avgAppsPerCandidate: 2.0,
    shareWithInterview: 0.5,
  },
};

const spec = SPECS[TIER];
const B = `perf-${TIER}`;

/**
 * Deterministic linear congruential PRNG for reproducible seed data (`seed` sets the sequence).
 *
 * @param seed - Initial state (unsigned 32-bit).
 * @returns A function that yields pseudo-random values in `[0, 1)`.
 */
function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const rand = makeRand(TIER === "small" ? 0x2f6a4b1d : TIER === "medium" ? 0x5c9d2e7a : 0x8a1b3c4d);

/**
 * Fisher–Yates sample of up to `n` elements using the global tier RNG (shuffles a copy of `arr`).
 */
function pickn<T>(arr: T[], n: number) {
  const o = [...arr];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o.slice(0, Math.min(n, o.length));
}

/**
 * Orchestrates tiered seeding: interview types, companies (batched), candidates, applications,
 * and first-step interviews using {@link getNextInterviewAttempt} for valid `attempt` values.
 * Refreshes materialized views when present; failures there are logged and ignored.
 */
async function main() {
  console.log(`Seeding tier=${TIER} batch=${B}`);

  const typeNames = [
    `${B} Phone Screen`,
    `${B} Technical`,
    `${B} Behavioral`,
    TIER === "large" ? `${B} System Design` : null,
  ].filter(Boolean) as string[];

  const types: { id: number; name: string }[] = [];
  for (const name of typeNames) {
    const t = await prisma.interviewType.upsert({
      where: { name },
      create: { name, description: `Seeded type ${name}` },
      update: {},
    });
    types.push(t);
  }

  const typeIds = types.map((t) => t.id);

  const COMPANY_SEED_CONCURRENCY = 4;

  /** Per-position identifiers after seeding one company (used to attach applications and interviews). */
  type PositionMetaRow = {
    id: number;
    companyId: number;
    flowId: number;
    firstStepId: number;
    stepIds: number[];
  };

  /**
   * Seeds one company: employees, interview flows/steps/types, positions, and metadata used later
   * for applications and interviews (first step id and full step id list per position).
   *
   * @param c - Zero-based company index within this run (feeds naming and isolated salary RNG).
   */
  async function seedOneCompany(c: number): Promise<{
    companyId: number;
    employeeIds: number[];
    positionMeta: PositionMetaRow[];
  }> {
    const comp = await prisma.company.create({
      data: { name: `${B} Co ${c + 1} — ${TIER} dataset` },
    });
    const companyId = comp.id;

    const employeeData = Array.from({ length: spec.employeesPerCompany }, (_, e) => ({
      companyId,
      name: `Employee ${B}-${companyId}-${e}`,
      email: `emp.${B}.${companyId}.${e}@example.com`,
      role: e % 3 === 0 ? "HiringManager" : e % 3 === 1 ? "Recruiter" : "IC",
    }));
    const employees = await prisma.employee.createManyAndReturn({ data: employeeData });
    const employeeIds = employees.map((e) => e.id);

    const flowData = Array.from({ length: spec.positionsPerCompany }, (_, p) => ({
      description: `Flow ${B} company ${companyId} pos ${p}`,
    }));
    const flows = await prisma.interviewFlow.createManyAndReturn({ data: flowData });

    const stepRows: {
      interviewFlowId: number;
      interviewTypeId: number;
      name: string;
      orderIndex: number;
    }[] = [];
    for (let p = 0; p < flows.length; p++) {
      const flow = flows[p]!;
      for (let s = 0; s < spec.stepsPerFlow; s++) {
        const ti = (s + p) % typeIds.length;
        stepRows.push({
          interviewFlowId: flow.id,
          interviewTypeId: typeIds[ti]!,
          name: `Step ${s + 1} (${typeNames[ti]})`,
          orderIndex: s + 1,
        });
      }
    }
    const allSteps = await prisma.interviewStep.createManyAndReturn({ data: stepRows });

    const firstStepIdByPos: number[] = [];
    const stepIdsByPos: number[][] = [];
    for (let p = 0; p < spec.positionsPerCompany; p++) {
      const chunk = allSteps.slice(p * spec.stepsPerFlow, (p + 1) * spec.stepsPerFlow);
      const sids = chunk.map((st) => st.id);
      stepIdsByPos.push(sids);
      firstStepIdByPos.push(sids[0]!);
    }

    // Isolated LCG for salaries (global `rand` is advanced in bulk after all companies)
    const salaryRng = makeRand(0x2f6a4b1d + c * 0x1f4d);
    const positionData = Array.from({ length: spec.positionsPerCompany }, (_, p) => ({
      companyId,
      interviewFlowId: flows[p]!.id,
      title: `Senior Software Engineer — ${B} ${c + 1}-${p + 1}`,
      description: "Full-time role (seeded).",
      status: p % 4 === 0 ? "open" : p % 4 === 1 ? "pausing" : "open",
      isVisible: p % 5 !== 0,
      location: c % 2 === 0 ? "Remote" : "Madrid",
      employmentType: "full_time",
      salaryMin: new Prisma.Decimal("65000.00").add(
        new Prisma.Decimal(Math.floor(salaryRng() * 20000).toString())
      ),
      salaryMax: new Prisma.Decimal("120000.00").add(
        new Prisma.Decimal(Math.floor(salaryRng() * 20000).toString())
      ),
      applicationDeadline: new Date(2026, 5, 15 + p),
    }));
    const positions = await prisma.position.createManyAndReturn({ data: positionData });

    const positionMeta: PositionMetaRow[] = positions.map((pos, p) => ({
      id: pos.id,
      companyId,
      flowId: flows[p]!.id,
      firstStepId: firstStepIdByPos[p]!,
      stepIds: stepIdsByPos[p]!,
    }));

    return { companyId, employeeIds, positionMeta };
  }

  const companyIds: number[] = [];
  const companyEmployeeIds: Map<number, number[]> = new Map();
  const positionMeta: PositionMetaRow[] = [];

  for (let start = 0; start < spec.companies; start += COMPANY_SEED_CONCURRENCY) {
    const batch = [] as number[];
    for (let c = start; c < start + COMPANY_SEED_CONCURRENCY && c < spec.companies; c++) {
      batch.push(c);
    }
    const batchOut = await Promise.all(batch.map((c) => seedOneCompany(c)));
    for (const r of batchOut) {
      companyIds.push(r.companyId);
      companyEmployeeIds.set(r.companyId, r.employeeIds);
      positionMeta.push(...r.positionMeta);
    }
  }

  for (let k = 0; k < 2 * spec.companies * spec.positionsPerCompany; k++) {
    rand();
  }

  const allPositionIds = positionMeta.map((m) => m.id);
  const appStatuses = ["new", "screening", "interviewing", "offer", "rejected"] as const;

  /**
   * Inserts `count` synthetic candidates with emails keyed by batch id `B`, chunked for large tiers.
   *
   * @param startIndex - Starting suffix for deterministic names/emails (usually after max existing id).
   * @param count - Number of candidate rows to create.
   */
  const createCandidates = async (startIndex: number, count: number) => {
    const data = [] as {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      address: string | null;
    }[];
    for (let i = 0; i < count; i++) {
      const n = startIndex + i;
      const city = pickn(["Austin", "Lisbon", "Berlin", "Bogotá", "Cairo"], 1)[0]!;
      data.push({
        firstName: TIER[0].toUpperCase() + TIER.slice(1),
        lastName: `Candidate${n}`,
        email: `cand.${B}.${n}@example.com`,
        phone: `+1${(5550000000 + (n % 9000000)).toString()}`,
        address:
          n % 7 === 0
            ? null
            : `${100 + n % 900} ${pickn(["Oak", "Maple", "Pine"], 1)[0]} St, ${city}`,
      });
    }
    for (let i = 0; i < data.length; i += 500) {
      await prisma.candidate.createMany({ data: data.slice(i, i + 500), skipDuplicates: true });
    }
  };

  const existingMax = await prisma.candidate.aggregate({ _max: { id: true } });
  const startAt = (existingMax._max.id ?? 0) + 1;
  // Deterministic: count how many with our email prefix
  const prefixCount = await prisma.candidate.count({
    where: { email: { startsWith: `cand.${B}.` } },
  });
  if (prefixCount === 0) {
    await createCandidates(startAt, spec.candidates);
  } else {
    console.log(`Skip candidate bulk: found ${prefixCount} rows for batch ${B} (re-run is idempotent for this batch).`);
  }

  const candidates = await prisma.candidate.findMany({
    where: { email: { startsWith: `cand.${B}.` } },
    select: { id: true },
  });
  const candidateIds = candidates.map((c) => c.id);

  const appRows: { positionId: number; candidateId: number; applicationDate: Date; status: string; notes: string | null }[] = [];
  const posById = new Map(positionMeta.map((m) => [m.id, m] as const));

  let appK = 0;
  for (const cid of candidateIds) {
    const nApp = Math.max(1, Math.round(spec.avgAppsPerCandidate * (0.7 + 0.6 * rand())));
    const positionsPicked = pickn(allPositionIds, Math.min(nApp, allPositionIds.length));
    for (const pid of positionsPicked) {
      appRows.push({
        positionId: pid,
        candidateId: cid,
        applicationDate: new Date(2025, 2 + (appK % 10), 1 + (appK % 25)),
        status: appStatuses[appK % appStatuses.length],
        notes: appK % 11 === 0 ? null : `Batch ${B} note ${appK}`,
      });
      appK++;
    }
  }

  for (let i = 0; i < appRows.length; i += 1000) {
    await prisma.application.createMany({ data: appRows.slice(i, i + 1000), skipDuplicates: true });
  }

  const applications = await prisma.application.findMany({
    where: { candidate: { email: { startsWith: `cand.${B}.` } } },
    select: { id: true, positionId: true },
  });

  const interviewRows: {
    applicationId: number;
    interviewStepId: number;
    attempt: number;
    employeeId: number;
    interviewDate: Date;
    result: string;
    score: number;
  }[] = [];

  for (const app of applications) {
    if (rand() > spec.shareWithInterview) continue;
    const meta = posById.get(app.positionId);
    if (!meta) continue;
    const emps = companyEmployeeIds.get(meta.companyId) ?? [];
    if (emps.length === 0) continue;
    const employeeId = emps[Math.floor(rand() * emps.length)]!;
    const attempt = await getNextInterviewAttempt(
      prisma,
      app.id,
      meta.firstStepId
    );
    interviewRows.push({
      applicationId: app.id,
      interviewStepId: meta.firstStepId,
      attempt,
      employeeId,
      interviewDate: new Date(2025, 6 + (app.id % 4), 5 + (app.id % 20)),
      result: pickn(["strong_hire", "hire", "no_hire", "pending"], 1)[0]!,
      score: 40 + Math.floor(rand() * 60),
    });
  }

  for (let i = 0; i < interviewRows.length; i += 500) {
    await prisma.interview.createMany({ data: interviewRows.slice(i, i + 500), skipDuplicates: true });
  }

  const counts = {
    company: await prisma.company.count({ where: { name: { contains: B } } }),
    employee: await prisma.employee.count({ where: { email: { contains: B } } }),
    position: await prisma.position.count({ where: { title: { contains: B } } }),
    application: await prisma.application.count({ where: { candidate: { email: { startsWith: `cand.${B}.` } } } }),
    interview: await prisma.interview.count({
      where: { application: { candidate: { email: { startsWith: `cand.${B}.` } } } },
    }),
    candidate: candidateIds.length,
  };

  console.log("Seeded row counts (this batch where applicable):", counts);

  try {
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW "ApplicationStatusSummary"`;
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW "CompanyApplicationCount"`;
  } catch (e) {
    console.warn("Materialized view refresh skipped (not deployed yet?):", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
