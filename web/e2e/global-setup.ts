import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIRNAME, '..', '..');
const DB_URL = 'postgres://sleek:sleek@localhost:5432/sleektodo';

export default async function globalSetup() {
  execSync('docker compose up -d --wait postgres redis', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  execSync('pnpm --filter @sleek-todo/api migration:run', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: DB_URL },
  });
}
