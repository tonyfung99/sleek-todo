import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { PresenceViewer } from './realtime.types';

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(listId: string): string {
    return `presence:list:${listId}`;
  }

  async join(listId: string, viewer: PresenceViewer): Promise<void> {
    await this.redis.hset(this.key(listId), viewer.userId, JSON.stringify(viewer));
  }

  async leave(listId: string, userId: string): Promise<void> {
    await this.redis.hdel(this.key(listId), userId);
  }

  async list(listId: string): Promise<PresenceViewer[]> {
    const raw = await this.redis.hgetall(this.key(listId));
    return Object.values(raw).map((v) => JSON.parse(v) as PresenceViewer);
  }
}
