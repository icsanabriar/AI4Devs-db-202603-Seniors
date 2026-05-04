/**
 * Unit tests for interview attempt sequencing: aggregate-based reads, batch allocation for
 * `createMany`, and transactional create with P2002 retries.
 */
import type { PrismaClient } from '@prisma/client';
import {
  createBatchInterviewAttemptAllocator,
  createInterviewWithNextAttempt,
  getNextInterviewAttempt,
  type InterviewPrisma,
} from './getNextInterviewAttempt';

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

/**
 * Ensures the allocator runs a single `groupBy` for distinct pairs, then issues monotonic
 * attempt numbers per `(applicationId, interviewStepId)` for the rest of the batch.
 */
describe('createBatchInterviewAttemptAllocator', () => {
  it('prefetches MAX once and hands out contiguous attempts per pair within the batch', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { applicationId: 1, interviewStepId: 10, _max: { attempt: 2 } },
    ]);
    const prisma = { interview: { groupBy } } as unknown as InterviewPrisma;

    const { next } = await createBatchInterviewAttemptAllocator(prisma, [
      { applicationId: 1, interviewStepId: 10 },
      { applicationId: 1, interviewStepId: 10 },
      { applicationId: 2, interviewStepId: 10 },
    ]);

    expect(next(1, 10)).toBe(3);
    expect(next(1, 10)).toBe(4);
    expect(next(2, 10)).toBe(1);
    expect(next(2, 10)).toBe(2);
    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Confirms transaction retries: first insert may lose the race on the composite unique,
 * the second attempt observes the updated max and succeeds.
 */
describe('createInterviewWithNextAttempt', () => {
  it('retries the transaction when composite unique P2002 fires (stale MAX+1)', async () => {
    const p2002 = Object.assign(new Error('uniq'), {
      code: 'P2002',
      meta: { modelName: 'Interview', target: ['applicationId', 'interviewStepId', 'attempt'] },
    });

    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({ _max: { attempt: 1 } })
      .mockResolvedValueOnce({ _max: { attempt: 2 } });

    let createCalls = 0;
    const create = jest.fn().mockImplementation(() => {
      createCalls++;
      if (createCalls === 1) return Promise.reject(p2002);
      return Promise.resolve({ id: 42 });
    });

    const txInterview = { aggregate, create };
    const prisma = {
      interview: txInterview,
      $transaction: jest.fn(async (fn: (tx: { interview: typeof txInterview }) => Promise<unknown>) =>
        fn({ interview: txInterview })
      ),
    } as unknown as PrismaClient;

    await expect(
      createInterviewWithNextAttempt(prisma, {
        applicationId: 1,
        interviewStepId: 2,
        employeeId: 3,
        interviewDate: new Date('2026-01-15'),
        result: null,
        score: null,
      })
    ).resolves.toEqual({ id: 42 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(createCalls).toBe(2);
  });
});
