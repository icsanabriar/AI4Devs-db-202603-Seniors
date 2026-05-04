/**
 * Verifies {@link getNextInterviewAttempt} returns the next attempt from Prisma aggregate
 * results: first interview uses `1`; subsequent rows use one greater than the stored maximum.
 */
import type { PrismaClient } from '@prisma/client';
import { getNextInterviewAttempt } from './getNextInterviewAttempt';

/**
 * Prisma stub: `interview.aggregate` resolves as if `_max.attempt` were `attemptMax`
 * (`null` means no rows, so the next attempt is `1`).
 *
 * @param attemptMax - Simulated maximum `Interview.attempt` for the queried pair, or `null` for none.
 */
function mockPrisma(attemptMax: number | null) {
  return {
    interview: {
      aggregate: jest.fn().mockResolvedValue({ _max: { attempt: attemptMax } }),
    },
  } as unknown as PrismaClient;
}

describe('getNextInterviewAttempt', () => {
  it('returns 1 when there are no prior interviews for the pair', async () => {
    const prisma = mockPrisma(null);
    await expect(getNextInterviewAttempt(prisma, 1, 2)).resolves.toBe(1);
  });

  it('returns max(attempt) + 1', async () => {
    const prisma = mockPrisma(3);
    await expect(getNextInterviewAttempt(prisma, 1, 2)).resolves.toBe(4);
  });
});
