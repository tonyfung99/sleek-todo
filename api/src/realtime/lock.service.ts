import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { LockHolder } from './realtime.types';

export const LOCK_TTL_SECONDS = 60;

// CAS-delete: only DEL when the stored holder's socketId matches ARGV[1].
const RELEASE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local holder = cjson.decode(raw)
if holder.socketId == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

// CAS-expire: only EXPIRE when the stored holder's socketId matches ARGV[1].
const REFRESH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local holder = cjson.decode(raw)
if holder.socketId == ARGV[1] then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

@Injectable()
export class LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private lockKey(listId: string, todoId: string): string {
    return `lock:list:${listId}:todo:${todoId}`;
  }

  private socketSetKey(socketId: string): string {
    return `socketlocks:${socketId}`;
  }

  async acquire(listId: string, todoId: string, owner: LockHolder): Promise<boolean> {
    const key = this.lockKey(listId, todoId);
    const res = await this.redis.set(
      key,
      JSON.stringify(owner),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (res !== 'OK') {
      return false;
    }
    await this.redis.sadd(this.socketSetKey(owner.socketId), `${listId}:${todoId}`);
    return true;
  }

  async refresh(listId: string, todoId: string, socketId: string): Promise<boolean> {
    const res = (await this.redis.eval(
      REFRESH_SCRIPT,
      1,
      this.lockKey(listId, todoId),
      socketId,
      String(LOCK_TTL_SECONDS),
    )) as number;
    return res === 1;
  }

  async release(listId: string, todoId: string, socketId: string): Promise<boolean> {
    const res = (await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      this.lockKey(listId, todoId),
      socketId,
    )) as number;
    await this.redis.srem(this.socketSetKey(socketId), `${listId}:${todoId}`);
    return res === 1;
  }

  async releaseAllForSocket(socketId: string): Promise<{ listId: string; todoId: string }[]> {
    const members = await this.redis.smembers(this.socketSetKey(socketId));
    const released: { listId: string; todoId: string }[] = [];
    for (const member of members) {
      const [listId, todoId] = member.split(':');
      const ok = await this.release(listId, todoId, socketId);
      if (ok) {
        released.push({ listId, todoId });
      }
    }
    await this.redis.del(this.socketSetKey(socketId));
    return released;
  }

  async getHolder(listId: string, todoId: string): Promise<LockHolder | null> {
    const raw = await this.redis.get(this.lockKey(listId, todoId));
    return raw ? (JSON.parse(raw) as LockHolder) : null;
  }
}
