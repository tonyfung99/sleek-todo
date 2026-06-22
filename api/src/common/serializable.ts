import { DataSource, EntityManager } from 'typeorm';

// Postgres serialization failure / deadlock SQLSTATEs.
const RETRYABLE = new Set(['40001', '40P01']);

function sqlState(err: unknown): string | undefined {
  return (err as { code?: string })?.code;
}

/**
 * Run `work` inside a SERIALIZABLE transaction, retrying on serialization
 * failures (40001) / deadlocks (40P01) with bounded exponential backoff + jitter.
 * Used for write-skew-prone operations (cycle-creating dependency adds and the
 * dependency-gated status transition) per design spec §9.2.
 */
export async function runSerializable<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await dataSource.transaction('SERIALIZABLE', work);
    } catch (err) {
      if (!RETRYABLE.has(sqlState(err) ?? '')) {
        throw err;
      }
      lastErr = err;
      const backoff = Math.min(50 * 2 ** attempt, 400) + (attempt * 7) % 13;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastErr;
}
