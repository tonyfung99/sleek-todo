import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIRNAME, '..');
const API_ENV = {
  DATABASE_URL: 'postgres://sleek:sleek@localhost:5432/sleektodo',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'e2e-only-secret-0123456789',
  CORS_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'development',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @sleek-todo/api start:dev',
      cwd: REPO_ROOT,
      env: API_ENV,
      url: 'http://localhost:3000/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter web dev',
      cwd: REPO_ROOT,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
