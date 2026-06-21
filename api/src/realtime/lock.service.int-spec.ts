import Redis from 'ioredis';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { LockService } from './lock.service';
import { LockHolder } from './realtime.types';

describe('LockService (integration, real Redis)', () => {
  let infra: TestInfra;
  let redis: Redis;
  let lock: LockService;

  const owner: LockHolder = { userId: 'u1', displayName: 'Alice', socketId: 'sock-1' };
  const owner2: LockHolder = { userId: 'u2', displayName: 'Bob', socketId: 'sock-2' };

  beforeAll(async () => {
    infra = await startTestInfra();
    redis = new Redis(infra.redisUrl);
    lock = new LockService(redis);
  });

  afterAll(async () => {
    redis.disconnect();
    await infra?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('acquires a free lock and denies it when held', async () => {
    expect(await lock.acquire('L', 'T', owner)).toBe(true);
    expect(await lock.acquire('L', 'T', owner2)).toBe(false);
    const holder = await lock.getHolder('L', 'T');
    expect(holder?.userId).toBe('u1');
  });

  it('release by the owning socket deletes the lock', async () => {
    await lock.acquire('L', 'T', owner);
    await lock.release('L', 'T', owner.socketId);
    expect(await lock.getHolder('L', 'T')).toBeNull();
    expect(await lock.acquire('L', 'T', owner2)).toBe(true);
  });

  it('release by a non-owning socket is a no-op', async () => {
    await lock.acquire('L', 'T', owner);
    await lock.release('L', 'T', 'someone-else');
    expect((await lock.getHolder('L', 'T'))?.userId).toBe('u1');
  });

  it('refresh extends TTL only for the owning socket', async () => {
    await lock.acquire('L', 'T', owner);
    await redis.expire('lock:list:L:todo:T', 5);
    await lock.refresh('L', 'T', owner.socketId);
    const ttl = await redis.ttl('lock:list:L:todo:T');
    expect(ttl).toBeGreaterThan(50);

    await redis.expire('lock:list:L:todo:T', 5);
    await lock.refresh('L', 'T', 'other-socket');
    expect(await redis.ttl('lock:list:L:todo:T')).toBeLessThanOrEqual(5);
  });

  it('releaseAllForSocket clears every lock held by a socket', async () => {
    await lock.acquire('L', 'T1', owner);
    await lock.acquire('L', 'T2', owner);
    const released = await lock.releaseAllForSocket(owner.socketId);
    expect(released).toEqual(
      expect.arrayContaining([
        { listId: 'L', todoId: 'T1' },
        { listId: 'L', todoId: 'T2' },
      ]),
    );
    expect(await lock.getHolder('L', 'T1')).toBeNull();
    expect(await lock.getHolder('L', 'T2')).toBeNull();
  });
});
