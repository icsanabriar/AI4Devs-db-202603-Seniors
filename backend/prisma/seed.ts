/**
 * Realistic, tiered test data for performance / validation runs.
 * Run:  SEED_TIER=small|medium|large  npx prisma db seed
 * Env:  DATABASE_URL (full URL) or root .env DB_USER/DB_PASSWORD/DB_NAME/DB_PORT
 */
import { PrismaClient, Prisma } from "@prisma/client";
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

function makeRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const rand = makeRand(TIER === "small" ? 0x2f6a4b1d : TIER === "medium" ? 0x5c9d2e7a : 0x8a1b3c4d);

function pickn<T>(arr: T[], n: number) {
  const o = [...arr];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o.slice(0, Math.min(n, o.length));
}

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
  const companyIds: number[] = [];
  const companyEmployeeIds: Map<number, number[]> = new Map();
  const positionMeta: { id: number; companyId: number; flowId: number; firstStepId: number; stepIds: number[] }[] = [];

  for (let c = 0; c < spec.companies; c++) {
    const comp = await prisma.company.create({
      data: {
        name: `${B} Co ${c + 1} — ${TIER} dataset`,
      },
    });
    companyIds.push(comp.id);
    const emps: number[] = [];
    for (let e = 0; e < spec.employeesPerCompany; e++) {
      const emp = await prisma.employee.create({
        data: {
          companyId: comp.id,
          name: `Employee ${B}-${comp.id}-${e}`,
          email: `emp.${B}.${comp.id}.${e}@example.com`,
          role: e % 3 === 0 ? "HiringManager" : e % 3 === 1 ? "Recruiter" : "IC",
        },
      });
      emps.push(emp.id);
    }
    companyEmployeeIds.set(comp.id, emps);

    for (let p = 0; p < spec.positionsPerCompany; p++) {
      const flow = await prisma.interviewFlow.create({
        data: { description: `Flow ${B} company ${comp.id} pos ${p}` },
      });
      const stepIds: number[] = [];
      for (let s = 0; s < spec.stepsPerFlow; s++) {
        const st = await prisma.interviewStep.create({
          data: {
            interviewFlowId: flow.id,
            interviewTypeId: typeIds[(s + p) % typeIds.length],
            name: `Step ${s + 1} (${typeNames[(s + p) % typeIds.length]})`,
            orderIndex: s + 1,
          },
        });
        stepIds.push(st.id);
      }
      const firstStepId = stepIds[0]!;
      const pos = await prisma.position.create({
        data: {
          companyId: comp.id,
          interviewFlowId: flow.id,
          title: `Senior Software Engineer — ${B} ${c + 1}-${p + 1}`,
          description: "Full-time role (seeded).",
          status: p % 4 === 0 ? "open" : p % 4 === 1 ? "pausing" : "open",
          isVisible: p % 5 !== 0,
          location: c % 2 === 0 ? "Remote" : "Madrid",
          employmentType: "full_time",
          salaryMin: new Prisma.Decimal("65000.00").add(
            new Prisma.Decimal(Math.floor(rand() * 20000).toString())
          ),
          salaryMax: new Prisma.Decimal("120000.00").add(
            new Prisma.Decimal(Math.floor(rand() * 20000).toString())
          ),
          applicationDeadline: new Date(2026, 5, 15 + p),
        },
      });
      positionMeta.push({
        id: pos.id,
        companyId: comp.id,
        flowId: flow.id,
        firstStepId,
        stepIds,
      });
    }
  }

  const allPositionIds = positionMeta.map((m) => m.id);
  const appStatuses = ["new", "screening", "interviewing", "offer", "rejected"] as const;

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
    interviewRows.push({
      applicationId: app.id,
      interviewStepId: meta.firstStepId,
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
