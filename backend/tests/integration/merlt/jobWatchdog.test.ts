import { describe, it, expect, beforeEach } from 'vitest';
import { sweepStuckJobs } from '../../../src/services/merlt/jobWatchdog';
import { prisma, createTestUser, type TestUser } from '../../helpers';

let user: TestUser;
beforeEach(async () => {
  user = await createTestUser('watchdog-test');
});

describe('sweepStuckJobs (loop-closure reliability)', () => {
  it('flips a pending extraction job older than threshold to timeout', async () => {
    const oldCreated = new Date(Date.now() - 30 * 60 * 1000);
    const job = await prisma.merltExtractionJob.create({
      data: {
        documentId: '999',
        userId: user.id,
        status: 'pending',
        createdAt: oldCreated,
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000);

    expect(result.extractFlipped).toBeGreaterThanOrEqual(1);
    const refreshed = await prisma.merltExtractionJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('timeout');
    expect(refreshed?.errorMessage).toContain('watchdog');
    expect(refreshed?.completedAt).not.toBeNull();
  });

  it('leaves recent pending jobs alone', async () => {
    await prisma.merltExtractionJob.create({
      data: {
        documentId: '998',
        userId: user.id,
        status: 'pending',
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000);

    expect(result.extractFlipped).toBe(0);
  });

  it('flips stuck ingestion jobs too', async () => {
    const oldCreated = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.merltIngestionJob.create({
      data: {
        articleUrn: 'urn:test:watchdog',
        userId: user.id,
        status: 'pending',
        createdAt: oldCreated,
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000);

    expect(result.ingestFlipped).toBeGreaterThanOrEqual(1);
  });

  it('does NOT touch completed/failed/timeout rows', async () => {
    const oldCreated = new Date(Date.now() - 30 * 60 * 1000);
    for (const status of ['completed', 'failed', 'timeout'] as const) {
      await prisma.merltExtractionJob.create({
        data: {
          documentId: `terminal-${status}`,
          userId: user.id,
          status,
          createdAt: oldCreated,
        },
      });
    }

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000);

    expect(result.extractFlipped).toBe(0);
  });
});
