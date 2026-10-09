import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ACCOUNT_LOCKOUT_SECONDS, LOGIN_RATE_LIMIT } from './auth.constants';

/**
 * Login rate limiting (TZ 6.5): 5 attempts / 15 min, tracked independently
 * per IP and per account — either one alone is enough to block further
 * attempts. `accountKey` is derived from the raw (tenant_slug, login) input,
 * not a resolved user id: it must behave identically whether or not the
 * account actually exists, or the timing/limiting behavior itself would
 * leak which logins are valid.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  private ipKey(ip: string): string {
    return `auth:attempts:ip:${ip}`;
  }

  private accountKey(key: string): string {
    return `auth:attempts:account:${key}`;
  }

  private lockKey(key: string): string {
    return `auth:lock:${key}`;
  }

  async assertLoginAllowed(ip: string, accountKey: string): Promise<void> {
    const [locked, ipCount, accountCount] = await Promise.all([
      this.redis.client.get(this.lockKey(accountKey)),
      this.redis.client.get(this.ipKey(ip)),
      this.redis.client.get(this.accountKey(accountKey)),
    ]);

    if (locked) {
      this.tooManyRequests('ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed logins');
    }
    if (Number(ipCount ?? 0) >= LOGIN_RATE_LIMIT.maxAttempts) {
      this.tooManyRequests('RATE_LIMITED', 'Too many login attempts from this IP, try again later');
    }
    if (Number(accountCount ?? 0) >= LOGIN_RATE_LIMIT.maxAttempts) {
      this.tooManyRequests('RATE_LIMITED', 'Too many login attempts for this account, try again later');
    }
  }

  async recordFailure(ip: string, accountKey: string): Promise<void> {
    const [, accountCount] = await Promise.all([
      this.incrWithExpiry(this.ipKey(ip), LOGIN_RATE_LIMIT.windowSeconds),
      this.incrWithExpiry(this.accountKey(accountKey), LOGIN_RATE_LIMIT.windowSeconds),
    ]);

    if (accountCount >= LOGIN_RATE_LIMIT.maxAttempts) {
      await this.redis.client.set(this.lockKey(accountKey), '1', 'EX', ACCOUNT_LOCKOUT_SECONDS);
    }
  }

  async recordSuccess(ip: string, accountKey: string): Promise<void> {
    await Promise.all([
      this.redis.client.del(this.ipKey(ip)),
      this.redis.client.del(this.accountKey(accountKey)),
      this.redis.client.del(this.lockKey(accountKey)),
    ]);
  }

  private async incrWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, windowSeconds);
    }
    return count;
  }

  private tooManyRequests(code: string, message: string): never {
    throw new HttpException({ code, message, details: null }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
