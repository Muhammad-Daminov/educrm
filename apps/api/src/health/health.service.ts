import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

export type DependencyStatus = 'ok' | 'error';

export interface ReadinessResult {
  status: 'ok' | 'error';
  dependencies: {
    db: DependencyStatus;
    redis: DependencyStatus;
  };
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly redis: Redis;

  constructor(configService: ConfigService<Env, true>) {
    this.pool = new Pool({ connectionString: configService.get('DATABASE_URL') });
    this.redis = new Redis(configService.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async checkReadiness(): Promise<ReadinessResult> {
    const [db, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'error',
      dependencies: { db, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await this.pool.query('SELECT 1');
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await this.redis.connect();
      }
      await this.redis.ping();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.redis.disconnect();
  }
}
