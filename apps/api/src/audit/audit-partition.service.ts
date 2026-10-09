import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import type { Env } from '../config/env.validation';

/**
 * How many *future* months must always have a partition. Product-owner
 * decision (docs/ROADMAP.md): ">= 3 months of future partitions". Three
 * months of runway means the job can fail unnoticed for a full quarter
 * before an audit write starts failing.
 */
export const AUDIT_PARTITION_MONTHS_AHEAD = 3;

/** The `audit_log_YYYY_MM` naming `ensure_audit_log_partition` derives. */
export function auditPartitionName(month: Date): string {
  const year = month.getUTCFullYear();
  const paddedMonth = String(month.getUTCMonth() + 1).padStart(2, '0');
  return `audit_log_${year}_${paddedMonth}`;
}

/**
 * The months that must exist at `now`: the current one plus
 * `monthsAhead` following ones, as first-of-month UTC dates.
 */
export function monthsToEnsure(now: Date, monthsAhead: number): Date[] {
  const months: Date[] = [];
  for (let offset = 0; offset <= monthsAhead; offset += 1) {
    months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
  }
  return months;
}

/**
 * Keeps `audit_log`'s monthly partitions ahead of the clock (TZ M11.3:
 * monthly partitioning, >= 3 years retention).
 *
 * The audit_log migration pre-created 36 months and deliberately created no
 * DEFAULT partition, so an INSERT into an uncovered month *fails* — which
 * is the right behaviour for an append-only audit trail (a default
 * partition could only be drained later by a DELETE the append-only
 * trigger forbids), but it means a missing partition breaks every audited
 * operation. This job is what keeps that from happening.
 *
 * It runs in the worker process only (TZ 7.1), once at startup and then on
 * an interval. Checking daily rather than monthly is deliberate: "monthly"
 * describes the partitions, not the schedule, and a job that only fires on
 * the 1st has twelve chances a year to be asleep during a deploy. Every
 * call is idempotent, so the extra checks cost one `to_regclass` lookup per
 * month and do nothing else.
 */
@Injectable()
export class AuditPartitionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AuditPartitionService.name);
  private timer: NodeJS.Timeout | undefined;
  /** Guards against a slow run overlapping the next tick. */
  private running = false;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get('APP_ROLE', { infer: true }) !== 'worker') {
      return;
    }

    const interval = this.configService.get('AUDIT_PARTITION_CHECK_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // Don't hold the process open on this timer alone.
    this.timer.unref();

    this.logger.log(
      `audit_log partition maintenance: keeping ${AUDIT_PARTITION_MONTHS_AHEAD} month(s) ` +
        `of runway, checked every ${interval}ms`,
    );
    // Run immediately too: a worker that starts after the runway has run
    // out must not wait for the first interval to repair it.
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One maintenance pass. Returns the partitions it had to create, which is
   * normally none. Never throws: a failed pass logs and leaves the next one
   * to retry, exactly like the outbox dispatcher's tick.
   */
  async tick(now: Date = new Date()): Promise<string[]> {
    if (this.running) {
      return [];
    }
    this.running = true;
    try {
      const created = await this.ensureFuturePartitions(now);
      if (created.length > 0) {
        this.logger.log(`Created audit_log partition(s): ${created.join(', ')}`);
      }
      return created;
    } catch (error) {
      this.logger.error(
        `audit_log partition maintenance failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    } finally {
      this.running = false;
    }
  }

  /**
   * Ensures a partition exists for the current month and the next
   * `AUDIT_PARTITION_MONTHS_AHEAD`, and returns the names of the ones that
   * were missing. Exposed for tests, which drive it with an explicit `now`.
   *
   * The existence check is done here rather than inferred from
   * `ensure_audit_log_partition`'s return value (it returns the partition
   * name whether it created it or not), so "what did this job change" is
   * answerable in the log.
   */
  async ensureFuturePartitions(now: Date = new Date()): Promise<string[]> {
    const created: string[] = [];

    for (const month of monthsToEnsure(now, AUDIT_PARTITION_MONTHS_AHEAD)) {
      const name = auditPartitionName(month);
      const existedBefore = await this.partitionExists(name);
      // Called even when it exists: the call is a cheap no-op, and skipping
      // it would make a partition that vanished between the check and here
      // (or was never finished) stay missing until the next tick.
      const monthStart = month.toISOString().slice(0, 10);
      await this.prisma.$queryRaw`SELECT ensure_audit_log_partition(${monthStart}::date)`;
      if (!existedBefore) {
        created.push(name);
      }
    }

    return created;
  }

  private async partitionExists(name: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<
      { exists: boolean }[]
    >`SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists`;
    return rows[0]?.exists === true;
  }
}
