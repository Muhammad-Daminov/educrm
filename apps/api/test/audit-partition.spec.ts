import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  AUDIT_PARTITION_MONTHS_AHEAD,
  AuditPartitionService,
  auditPartitionName,
  monthsToEnsure,
} from '../src/audit/audit-partition.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { Env } from '../src/config/env.validation';

/**
 * The service only ever reaches Postgres through `$queryRaw`, so a stub of
 * that one method is enough to drive `tick` without a database. The
 * DDL-side behaviour (grants, policies, concurrency) is covered against a
 * real Postgres in test/integration/audit-partition.spec.ts.
 */
function serviceWith(queryRaw: () => Promise<unknown[]>): AuditPartitionService {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const config = { get: () => 'api' } as unknown as ConfigService<Env, true>;
  return new AuditPartitionService(config, prisma);
}

describe('auditPartitionName', () => {
  it('matches the YYYY_MM naming ensure_audit_log_partition derives', () => {
    expect(auditPartitionName(new Date('2026-10-01T00:00:00Z'))).toBe('audit_log_2026_10');
    expect(auditPartitionName(new Date('2027-01-31T23:59:59Z'))).toBe('audit_log_2027_01');
  });

  it('zero-pads single-digit months', () => {
    expect(auditPartitionName(new Date('2027-09-01T00:00:00Z'))).toBe('audit_log_2027_09');
  });
});

describe('monthsToEnsure', () => {
  it('returns the current month plus the requested runway', () => {
    const months = monthsToEnsure(new Date('2029-08-14T09:00:00Z'), 3);
    expect(months.map(auditPartitionName)).toEqual([
      'audit_log_2029_08',
      'audit_log_2029_09',
      'audit_log_2029_10',
      'audit_log_2029_11',
    ]);
  });

  it('rolls over the year', () => {
    const months = monthsToEnsure(new Date('2029-11-30T23:00:00Z'), 3);
    expect(months.map(auditPartitionName)).toEqual([
      'audit_log_2029_11',
      'audit_log_2029_12',
      'audit_log_2030_01',
      'audit_log_2030_02',
    ]);
  });

  it('normalizes to the first of the month, which is the partition bound', () => {
    for (const month of monthsToEnsure(new Date('2030-03-31T22:30:00Z'), 3)) {
      expect(month.getUTCDate()).toBe(1);
      expect(month.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it('keeps the runway the product owner asked for: >= 3 future months', () => {
    const now = new Date('2029-09-15T00:00:00Z');
    const months = monthsToEnsure(now, AUDIT_PARTITION_MONTHS_AHEAD);
    const future = months.filter(
      (month) => month > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    expect(future.length).toBeGreaterThanOrEqual(3);
    // The current month is included too — a worker starting on a clean
    // database would otherwise have nowhere to write today's audit rows.
    expect(auditPartitionName(months[0] ?? now)).toBe('audit_log_2029_09');
  });
});

describe('AuditPartitionService.tick', () => {
  it('reports only the months that were missing', async () => {
    // Existence probe answers "false" for the first month, "true" after.
    let probes = 0;
    const service = serviceWith(() => {
      probes += 1;
      // Odd calls are the to_regclass probe, even ones the ensure() call.
      if (probes % 2 === 1) {
        return Promise.resolve([{ exists: probes > 1 }]);
      }
      return Promise.resolve([]);
    });

    const created = await service.tick(new Date('2030-01-09T00:00:00Z'));

    expect(created).toEqual(['audit_log_2030_01']);
    // One probe + one ensure per month in the window.
    expect(probes).toBe(2 * (AUDIT_PARTITION_MONTHS_AHEAD + 1));
  });

  it('swallows a failing pass instead of killing the schedule', async () => {
    // An unhandled rejection inside a setInterval callback takes the worker
    // process down, so the pass has to absorb its own failures.
    const service = serviceWith(() => Promise.reject(new Error('connection terminated')));

    await expect(service.tick(new Date('2030-01-09T00:00:00Z'))).resolves.toEqual([]);
  });

  it('does not let a slow pass overlap the next tick', async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const service = serviceWith(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [{ exists: true }];
    });

    const now = new Date('2030-01-09T00:00:00Z');
    const [first, second] = await Promise.all([service.tick(now), service.tick(now)]);

    expect(maxConcurrent).toBe(1);
    expect(first).toEqual([]);
    // The second call found a pass already running and did nothing.
    expect(second).toEqual([]);
  });

  it('starts no timer and runs no pass in the api process', () => {
    const queryRaw = vi.fn(() => Promise.resolve([{ exists: true }]));
    const service = serviceWith(queryRaw);

    service.onModuleInit();

    expect(queryRaw).not.toHaveBeenCalled();
    // Shutdown with no timer must be a no-op, not a crash.
    expect(() => service.onApplicationShutdown()).not.toThrow();
  });
});
