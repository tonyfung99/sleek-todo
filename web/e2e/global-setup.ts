import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIRNAME, '..', '..');
const DB_URL = 'postgres://sleek:sleek@localhost:5432/sleektodo';

export default async function globalSetup() {
  // In CI, Postgres + Redis are provided as service containers and migrations
  // are run as an explicit workflow step, so this setup is a no-op there.
  if (process.env.CI) return;

  // Best-effort: bring Postgres + Redis up via compose. If that fails (e.g. they
  // are already provided some other way), continue — migration:run below will
  // surface a genuinely unreachable database.
  try {
    execSync('docker compose up -d --wait postgres redis', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  } catch {
    console.warn('global-setup: `docker compose up postgres redis` failed; assuming infra is already running');
  }
  execSync('pnpm --filter @sleek-todo/api migration:run', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
