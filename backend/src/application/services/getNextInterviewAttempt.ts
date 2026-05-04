import type { Interview, Prisma, PrismaClient } from '@prisma/client';

/**
 * Retry ceiling for {@link createInterviewWithNextAttempt} when concurrent writers race on
 * the `(applicationId, interviewStepId, attempt)` unique constraint.
 */
export const CREATE_INTERVIEW_ATTEMPT_MAX_RETRIES = 8;

const interviewUniqueTarget = ['applicationId', 'interviewStepId', 'attempt'];

/**
 * Reads Prisma `P2002` metadata shape and returns sanitized `meta.target` column names when present.
 *
 * @param meta - Raw error object or wrapper possibly holding `{ meta: { target } }`.
 */
function parseTarget(meta: unknown): string[] | undefined {
  const t = meta as { meta?: { target?: unknown } } | undefined;
  const target = t?.meta?.target;
  return Array.isArray(target)
    ? target.filter((x): x is string => typeof x === 'string')
    : undefined;
}

/**
 * Detects a uniqueness conflict on the interview attempt composite key (P2002 on `Interview`
 * or matching constraint name) so {@link createInterviewWithNextAttempt} can retry.
 *
 * @param e - Caught error from Prisma create/transaction.
 */
function isInterviewAttemptUniqueViolation(e: unknown): boolean {
  const err = e as {
    code?: string;
    meta?: {
      target?: unknown;
      modelName?: string;
      constraint?: string;
    };
  } | undefined;
  if (!err || err.code !== 'P2002') return false;
  if (err.meta?.modelName === 'Interview') return true;
  const c = String(err.meta?.constraint ?? '');
  if (c.includes('applicationId_interviewStepId_attempt')) return true;

  const target = parseTarget(e as { meta?: { target?: unknown } });
  return (
    target !== undefined &&
    interviewUniqueTarget.every((col) => target.includes(col))
  );
}

/** Any client that exposes `Interview` aggregates / creates (includes `TransactionClient`). */
export type InterviewPrisma = Pick<PrismaClient, 'interview'>;

/**
 * Computes the next 1-based `Interview.attempt` for an application and interview step.
 *
 * For **writes**, prefer {@link createInterviewWithNextAttempt} (transaction + retries) or {@link createBatchInterviewAttemptAllocator}
 * for batched inserts so concurrency cannot reuse the same `(applicationId, interviewStepId, attempt)`.
 *
 * @param prisma - Prisma root client or transactional client (`$transaction` callback receiver).
 * @param applicationId - Application the interview is associated with.
 * @param interviewStepId - Flow step being scheduled (retakes share this id with higher `attempt`).
 * @returns `1` when no prior interviews exist for the pair; otherwise `max(attempt) + 1`.
 */
export async function getNextInterviewAttempt(
  prisma: InterviewPrisma,
  applicationId: number,
  interviewStepId: number
): Promise<number> {
  const result = await prisma.interview.aggregate({
    where: { applicationId, interviewStepId },
    _max: { attempt: true },
  });
  return (result._max.attempt ?? 0) + 1;
}

/** Keys used to prefetch existing max attempts before a bulk `createMany` of interviews. */
export type PlannedInterviewAttemptPair = Pick<
  Prisma.InterviewUncheckedCreateInput,
  'applicationId' | 'interviewStepId'
>;

/** Stable map key for `(applicationId, interviewStepId)` in the batch attempt allocator. */
function pairKey(applicationId: number, interviewStepId: number): string {
  return `${applicationId}:${interviewStepId}`;
}

/**
 * For `createMany` / bulk builders: prefetch DB max `(applicationId, interviewStepId)` attempts once,
 * then hand out **`applicationId`,`interviewStepId`-unique attempts in memory within this process**.
 * Covers concurrent duplicates within one batch without races between aggregates and inserts.
 *
 * Ordering of `plannedRows` emission must equal call order — each call allocates the next integer for that pair.
 */
export async function createBatchInterviewAttemptAllocator(
  prisma: InterviewPrisma,
  plannedRows: readonly PlannedInterviewAttemptPair[]
): Promise<{ next(applicationId: number, interviewStepId: number): number }> {
  const uniqueByKey = new Map<string, PlannedInterviewAttemptPair>();
  for (const row of plannedRows) {
    const k = pairKey(row.applicationId, row.interviewStepId);
    if (!uniqueByKey.has(k)) uniqueByKey.set(k, row);
  }
  const list = Array.from(uniqueByKey.values());
  const maxRows =
    list.length === 0
      ? []
      : await prisma.interview.groupBy({
          by: ['applicationId', 'interviewStepId'],
          where: {
            OR: list.map(({ applicationId, interviewStepId }) => ({
              applicationId,
              interviewStepId,
            })),
          },
          _max: { attempt: true },
        });

  const nextFree = new Map<string, number>();
  for (const row of maxRows) {
    nextFree.set(pairKey(row.applicationId, row.interviewStepId), (row._max.attempt ?? 0) + 1);
  }

  function next(applicationId: number, interviewStepId: number): number {
    const k = pairKey(applicationId, interviewStepId);
    const cur = nextFree.get(k) ?? 1;
    nextFree.set(k, cur + 1);
    return cur;
  }
  return { next };
}

/** Interview row input without `attempt`; {@link createInterviewWithNextAttempt} sets `attempt` inside the transaction. */
export type InterviewCreateSansAttemptInput = Omit<Prisma.InterviewUncheckedCreateInput, 'attempt'>;

/**
 * Inserts exactly one interview row whose `attempt` is chosen after `MAX(existing)+1`
 * inside a short **`$transaction`**, retrying **`P2002`** on the composite `(applicationId, interviewStepId, attempt)` unique
 * (another writer may have advanced the counter between aggregate and insert under read-committed semantics).
 *
 * Prefer this over **`getNextInterviewAttempt`** + **`interview.create`** as separate awaited calls outside a retry loop.
 */
export async function createInterviewWithNextAttempt(
  prisma: PrismaClient,
  data: InterviewCreateSansAttemptInput
): Promise<Interview> {
  let last: unknown;

  const { applicationId, interviewStepId } = data;
  if (
    typeof applicationId !== 'number' ||
    typeof interviewStepId !== 'number'
  ) {
    throw new Error(
      'createInterviewWithNextAttempt requires numeric applicationId and interviewStepId'
    );
  }

  for (let i = 0; i < CREATE_INTERVIEW_ATTEMPT_MAX_RETRIES; i++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const attempt = await getNextInterviewAttempt(tx, applicationId, interviewStepId);
        return tx.interview.create({
          data: { ...data, attempt },
        });
      });
    } catch (e) {
      if (isInterviewAttemptUniqueViolation(e)) {
        last = e;
        continue;
      }
      throw e;
    }
  }

  throw last instanceof Error ? last : new Error('createInterviewWithNextAttempt: exhausted retries');
}
