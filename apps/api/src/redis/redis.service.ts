import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  client!: Redis;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.client = new Redis(this.configService.get('REDIS_URL', { infer: true }));
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
