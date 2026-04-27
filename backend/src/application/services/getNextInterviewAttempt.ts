import type { PrismaClient } from '@prisma/client';

/**
 * Next 1-based `Interview.attempt` for this application + step. Call before every
 * `interview.create` (and when building `createMany` rows) so the row does not
 * collide on `@@unique([applicationId, interviewStepId, attempt])`.
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
