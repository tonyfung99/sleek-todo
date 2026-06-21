import { HealthCheckError } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  it('returns up when ping succeeds', async () => {
    const fakeRedis = { ping: jest.fn().mockResolvedValue('PONG') } as any;
    const indicator = new RedisHealthIndicator(fakeRedis);
    await expect(indicator.isHealthy('redis')).resolves.toEqual({
      redis: { status: 'up' },
    });
  });

  it('throws HealthCheckError when ping fails', async () => {
    const fakeRedis = { ping: jest.fn().mockRejectedValue(new Error('boom')) } as any;
    const indicator = new RedisHealthIndicator(fakeRedis);
    await expect(indicator.isHealthy('redis')).rejects.toBeInstanceOf(HealthCheckError);
  });
});
