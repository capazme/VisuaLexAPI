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

  // FIX 1: async progressive Q&A jobs are swept on liveness (updatedAt), not
  // age-since-submit (createdAt) — a heavy ReAct deliberation legitimately
  // runs up to ~11min and each per-expert callback bumps updatedAt.
  it('does NOT sweep a running QA job that is old but still actively progressing', async () => {
    const oldCreated = new Date(Date.now() - 15 * 60 * 1000); // 15min ago
    const recentUpdate = new Date(Date.now() - 1 * 60 * 1000); // 1min ago
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'question that takes a while',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'running',
        createdAt: oldCreated,
        updatedAt: recentUpdate,
      },
    });

    // 10-min default staleAfterMs + a 20-min qaStaleAfterMs threshold: the
    // job's createdAt (15min ago) is well past the tighter 10-min net, but
    // its updatedAt (1min ago) is fresh, so it must survive.
    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000, 20 * 60 * 1000);

    expect(result.qaFlipped).toBe(0);
    const refreshed = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('running');
  });

  it('flips a running QA job to timeout once updatedAt exceeds qaStaleAfterMs (genuine silence)', async () => {
    const staleUpdate = new Date(Date.now() - 25 * 60 * 1000); // 25min ago
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'question whose worker died',
        mode: 'divergent',
        consentLevel: 'full',
        status: 'running',
        createdAt: staleUpdate,
        updatedAt: staleUpdate,
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000, 20 * 60 * 1000);

    expect(result.qaFlipped).toBeGreaterThanOrEqual(1);
    const refreshed = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('timeout');
    expect(refreshed?.errorMessage).toContain('watchdog');
  });

  // FIX 2: retention sweep purges terminal QA jobs to bound table growth
  // (result carries the full ExpertQueryResponse, incl. pipeline_trace).
  it('purges terminal QA jobs older than the retention window', async () => {
    const oldCreated = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    const job = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'old completed question',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'completed',
        createdAt: oldCreated,
        result: { synthesis: 'stale result' },
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000, 20 * 60 * 1000, 30);

    expect(result.qaJobsPurged).toBeGreaterThanOrEqual(1);
    const refreshed = await prisma.merltQaJob.findUnique({ where: { id: job.id } });
    expect(refreshed).toBeNull();
  });

  it('leaves recent terminal QA jobs and non-terminal QA jobs alone during retention purge', async () => {
    const recentTerminal = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'recent completed question',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'completed',
      },
    });
    const oldButRunning = await prisma.merltQaJob.create({
      data: {
        userId: user.id,
        query: 'old but still running question',
        mode: 'convergent',
        consentLevel: 'full',
        status: 'running',
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(), // fresh — must survive both sweep and purge
      },
    });

    const result = await sweepStuckJobs(prisma, 10 * 60 * 1000, 20 * 60 * 1000, 30);

    expect(result.qaJobsPurged).toBe(0);
    expect(await prisma.merltQaJob.findUnique({ where: { id: recentTerminal.id } })).not.toBeNull();
    expect(await prisma.merltQaJob.findUnique({ where: { id: oldButRunning.id } })).not.toBeNull();
  });
});
