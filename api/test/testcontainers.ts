import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

export interface TestInfra {
  pg: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  databaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

export async function startTestInfra(): Promise<TestInfra> {
  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  return {
    pg,
    redis,
    databaseUrl: pg.getConnectionUri(),
    redisUrl: redis.getConnectionUrl(),
    stop: async () => {
      await Promise.all([pg.stop(), redis.stop()]);
    },
  };
}
