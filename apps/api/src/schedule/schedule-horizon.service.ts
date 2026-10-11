import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { TENANT_PRISMA, type TenantPrismaClient } from '../database/tenant-prisma.provider';
import { runInTenant } from '../tenant/run-in-tenant';
import type { Env } from '../config/env.validation';
import { ScheduleRulesService, todayIn } from './schedule-rules.service';
import { conflictKindOf } from './schedule.errors';

/**
 * TZ M4.3: "Gorizont — rolling 6 oy: kechki job har kuni gorizontni
 * uzaytiradi."
 *
 * Every active rule's lessons are materialized out to six months. Without
 * this job that horizon would be frozen at whatever it was when the rule
 * was saved, and the calendar would simply run dry — so this is what makes
 * "rolling" true rather than aspirational.
 *
 * Each rule is extended in its own transaction. One rule whose extension
 * hits a classroom conflict (a room that got booked out from under it in
 * the newly reachable months) must not take the other rules down with it:
 * that rule keeps its current horizon and is logged, and the next pass
 * tries again. Shape and failure stance copied from
 * `AuditPartitionService`/`OutboxDispatcher` — worker-only, immediate first
 * run, never throws out of a tick.
 */
@Injectable()
export class ScheduleHorizonService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduleHorizonService.name);
  private timer: NodeJS.Timeout | undefined;
  /** Guards against a slow pass overlapping the next tick. */
  private running = false;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TENANT_PRISMA) private readonly tenantDb: TenantPrismaClient,
    private readonly rules: ScheduleRulesService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get('APP_ROLE', { infer: true }) !== 'worker') {
      return;
    }

    const interval = this.configService.get('SCHEDULE_HORIZON_CHECK_INTERVAL_MS', { infer: true });
    this.timer = setInterval(() => {
      void this.tick();
    }, interval);
    // Don't hold the process open on this timer alone.
    this.timer.unref();

    this.logger.log(`Schedule horizon extension running every ${interval}ms`);
    // Immediately too: a worker starting after days of downtime must not
    // wait a full interval before refilling a calendar that has run dry.
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One pass over every tenant's active rules. Returns how many lessons it
   * created, which is normally a handful (one day's worth per rule) and is
   * zero on a second run the same day — `regenerate` skips dates a kept
   * lesson already covers, so re-running is idempotent.
   *
   * Exposed for tests, which drive it directly rather than waiting on the
   * interval.
   */
  async tick(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      // Per-tenant enumeration for the same reason the outbox dispatcher
      // does it: `schedule_rules` and `lessons` carry FORCE RLS, so no
      // connection can see every tenant's rules at once. `tenants` is the
      // one table with no tenant_id and no policy.
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      let created = 0;
      for (const tenant of tenants) {
        created += await runInTenant(tenant.id, () => this.extendTenant());
      }
      if (created > 0) {
        this.logger.log(`Horizon extension created ${created} lesson(s)`);
      }
      return created;
    } catch (error) {
      this.logger.error(
        `Schedule horizon tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Extends every active rule of the current tenant. */
  async extendTenant(): Promise<number> {
    const ruleIds = await this.tenantDb.scheduleRule.findMany({
      where: {
        isActive: true,
        // A rule whose period has already ended has nothing left to
        // generate; skipping them keeps the pass proportional to the
        // *live* schedule rather than to all history.
        OR: [{ periodEnd: null }, { periodEnd: { gte: new Date() } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    let created = 0;
    for (const { id } of ruleIds) {
      created += await this.extendRule(id);
    }
    return created;
  }

  private async extendRule(ruleId: string): Promise<number> {
    try {
      return await this.tenantDb.transaction(async (tx) => {
        const rule = await tx.scheduleRule.findUnique({
          where: { id: ruleId },
          select: { studyUnitId: true },
        });
        if (rule === null) {
          return 0;
        }
        const context = await this.rules.loadContext(tx, rule.studyUnitId);
        const outcome = await this.rules.regenerate(
          tx,
          ruleId,
          context,
          todayIn(context.timeZone),
          // Append-only: the horizon moving forward is not a reason to give
          // every already-planned lesson a new id.
          'extend',
        );
        return outcome.created;
      });
    } catch (error) {
      // A conflict here is a real, actionable situation (someone booked the
      // room in a month this rule had not reached yet), not a bug — so it
      // is a warning naming the rule, and the rule simply keeps its
      // current horizon until a human resolves it.
      if (conflictKindOf(error) !== null) {
        this.logger.warn(
          `Schedule rule ${ruleId} could not be extended: the slot is taken further out`,
        );
        return 0;
      }
      this.logger.error(
        `Schedule rule ${ruleId} extension failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}
