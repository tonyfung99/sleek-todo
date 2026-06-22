import Redis from 'ioredis';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { PresenceService } from './presence.service';

describe('PresenceService (integration, real Redis)', () => {
  let infra: TestInfra;
  let redis: Redis;
  let presence: PresenceService;

  beforeAll(async () => {
    infra = await startTestInfra();
    redis = new Redis(infra.redisUrl);
    presence = new PresenceService(redis);
  });

  afterAll(async () => {
    redis.disconnect();
    await infra?.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('join then list returns the viewer', async () => {
    await presence.join('L', { userId: 'u1', displayName: 'Alice', color: '#1' });
    expect(await presence.list('L')).toEqual([
      { userId: 'u1', displayName: 'Alice', color: '#1' },
    ]);
  });

  it('a duplicate join dedups on userId', async () => {
    await presence.join('L', { userId: 'u1', displayName: 'Alice', color: '#1' });
    await presence.join('L', { userId: 'u1', displayName: 'Alice', color: '#1' });
    expect(await presence.list('L')).toHaveLength(1);
  });

  it('leave removes the viewer', async () => {
    await presence.join('L', { userId: 'u1', displayName: 'Alice', color: '#1' });
    await presence.join('L', { userId: 'u2', displayName: 'Bob', color: '#2' });
    await presence.leave('L', 'u1');
    const viewers = await presence.list('L');
    expect(viewers.map((v) => v.userId)).toEqual(['u2']);
  });
});
