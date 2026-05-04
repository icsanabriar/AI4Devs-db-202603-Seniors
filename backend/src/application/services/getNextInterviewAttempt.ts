import type { PrismaClient } from '@prisma/client';

/**
 * Computes the next 1-based `Interview.attempt` for an application and interview step.
 *
 * Call this before every `interview.create` (and when building `createMany` rows) so new
 * rows do not violate `@@unique([applicationId, interviewStepId, attempt])`.
 *
 * @param prisma - Prisma client used to read the current max `attempt` for the pair.
 * @param applicationId - Application the interview is associated with.
 * @param interviewStepId - Flow step being scheduled (retakes share this id with higher `attempt`).
 * @returns `1` when no prior interviews exist for the pair; otherwise `max(attempt) + 1`.
 */
export async function getNextInterviewAttempt(
  prisma: PrismaClient,
  applicationId: number,
  interviewStepId: number
): Promise<number> {
  const result = await prisma.interview.aggregate({
    where: { applicationId, interviewStepId },
    _max: { attempt: true },
  });
  return (result._max.attempt ?? 0) + 1;
}
