# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the SleekTodo monorepo so `docker-compose up` yields a live NestJS API with working liveness/readiness probes backed by Postgres + Redis, structured logging, env validation, TypeORM migrations, a Testcontainers integration-test harness, and CI.

**Architecture:** pnpm-workspace monorepo (`api/`, `web/` added later). NestJS app with a config module (env validation via Joi), TypeORM (Postgres) wired through `forRootAsync`, ioredis, `@nestjs/terminus` health checks (Postgres + a custom Redis indicator), `nestjs-pino` JSON logging. Integration tests spin real Postgres + Redis via Testcontainers. docker-compose runs postgres + redis + api; CI runs lint + unit + integration.

**Tech Stack:** Node 20 LTS, pnpm, TypeScript, NestJS 10, TypeORM 0.3, pg, ioredis, `@nestjs/config` + joi, `@nestjs/terminus`, `nestjs-pino` + pino-http, Jest, `@testcontainers/postgresql` + `@testcontainers/redis`, Docker Compose, GitHub Actions.

> **Note on versions:** install latest stable of each package at execution time (`pnpm add`), then confirm the APIs used below still match (terminus, nestjs-pino, and testcontainers modular packages are the most likely to drift). If a test fails on an API mismatch, adjust to the installed version's API — the test is the source of truth.

---

## File Structure

```
sleek-todo/
├── package.json                      # root: workspace scripts, devDeps (eslint, prettier)
├── pnpm-workspace.yaml               # packages: ["api"]  (web added in plan 9)
├── tsconfig.base.json                # shared TS compiler options
├── .nvmrc                            # 20
├── .editorconfig
├── .env.example                      # documents required env vars
├── docker-compose.yml                # postgres + redis + api
├── .github/workflows/ci.yml          # lint + unit + integration
├── README.md                         # setup/dev instructions (stub, grows over plans)
└── api/
    ├── package.json
    ├── tsconfig.json                 # extends ../tsconfig.base.json
    ├── tsconfig.build.json
    ├── nest-cli.json
    ├── Dockerfile
    ├── .eslintrc.cjs
    ├── jest.config.ts                # unit test config (*.spec.ts)
    ├── jest.integration.config.ts    # integration config (*.int-spec.ts)
    ├── test/
    │   └── testcontainers.ts         # shared container bootstrap helper
    └── src/
        ├── main.ts                   # bootstrap (pino logger, swagger later)
        ├── app.module.ts             # root module wiring
        ├── config/
        │   ├── env.validation.ts     # Joi schema + validate()
        │   └── env.validation.spec.ts
        ├── database/
        │   └── data-source.ts        # TypeORM DataSource for CLI migrations
        └── health/
            ├── health.module.ts
            ├── health.controller.ts
            ├── redis.health.ts       # custom Redis health indicator
            ├── redis.health.spec.ts
            └── health.int-spec.ts    # integration: real pg + redis
```

---

## Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.editorconfig`, `README.md`

- [ ] **Step 1: Create root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "api"
```

`.nvmrc`:
```
20
```

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

`package.json`:
```json
{
  "name": "sleek-todo",
  "private": true,
  "engines": { "node": ">=20" },
  "scripts": {
    "api:dev": "pnpm --filter api start:dev",
    "api:test": "pnpm --filter api test",
    "api:test:int": "pnpm --filter api test:int",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "prettier": "^3.3.0"
  }
}
```

`README.md`:
```markdown
# SleekTodo

A Notion-style collaborative to-do application.

## Prerequisites
- Node 20 (`nvm use`)
- pnpm (`corepack enable`)
- Docker + Docker Compose

## Quick start
```bash
cp .env.example .env
docker compose up --build
# API: http://localhost:3000  •  Health: http://localhost:3000/health/ready
```

## Development
```bash
pnpm install
pnpm api:dev          # watch mode (needs local postgres+redis or `docker compose up postgres redis`)
pnpm api:test         # unit tests
pnpm api:test:int     # integration tests (Testcontainers; needs Docker running)
```
```

- [ ] **Step 2: Verify workspace resolves**

Run: `corepack enable && pnpm install`
Expected: completes without error (no packages yet beyond root devDeps).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo + shared tooling"
```

---

## Task 2: NestJS API app skeleton

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/tsconfig.build.json`, `api/nest-cli.json`, `api/.eslintrc.cjs`, `api/jest.config.ts`, `api/src/main.ts`, `api/src/app.module.ts`

- [ ] **Step 1: Create `api/package.json`**

```json
{
  "name": "@sleek-todo/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "lint": "eslint \"src/**/*.ts\"",
    "test": "jest --config jest.config.ts",
    "test:int": "jest --config jest.integration.config.ts --runInBand"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "@types/supertest": "^6.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create NestJS config files**

`api/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./",
    "sourceMap": true,
    "incremental": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

`api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts", "**/*.int-spec.ts"]
}
```

`api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`api/.eslintrc.cjs`:
```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { project: 'tsconfig.json', tsconfigRootDir: __dirname, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['plugin:@typescript-eslint/recommended'],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['dist', 'jest.config.ts', 'jest.integration.config.ts', '.eslintrc.cjs'],
  rules: { '@typescript-eslint/no-explicit-any': 'warn' },
};
```

`api/jest.config.ts`:
```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
```

- [ ] **Step 3: Create app skeleton**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
})
export class AppModule {}
```

`api/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

- [ ] **Step 4: Install and build**

Run: `pnpm install && pnpm --filter api build`
Expected: `dist/main.js` produced, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(api): NestJS app skeleton"
```

---

## Task 3: Env config module with validation (TDD)

**Files:**
- Create: `api/src/config/env.validation.ts`, `api/src/config/env.validation.spec.ts`
- Modify: `api/src/app.module.ts`
- Add deps: `@nestjs/config`, `joi`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter api add @nestjs/config joi`

- [ ] **Step 2: Write the failing test**

`api/src/config/env.validation.spec.ts`:
```ts
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('passes with all required vars', () => {
    expect(() => validateEnv(valid)).not.toThrow();
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv(valid).PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter api test -- env.validation`
Expected: FAIL — `Cannot find module './env.validation'`.

- [ ] **Step 4: Write minimal implementation**

`api/src/config/env.validation.ts`:
```ts
import * as Joi from 'joi';

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
}

const schema = Joi.object<AppEnv>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
});

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const { error, value } = schema.validate(config, { allowUnknown: true, abortEarly: false });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value as AppEnv;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- env.validation`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire ConfigModule into AppModule**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): env config module with Joi validation"
```

---

## Task 4: TypeORM data source + module wiring

**Files:**
- Create: `api/src/database/data-source.ts`
- Modify: `api/src/app.module.ts`, `api/package.json` (migration scripts)
- Add deps: `@nestjs/typeorm`, `typeorm`, `pg`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter api add @nestjs/typeorm typeorm pg`

- [ ] **Step 2: Create the CLI DataSource**

`api/src/database/data-source.ts`:
```ts
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
```

Run: `pnpm --filter api add -D dotenv`

- [ ] **Step 3: Add migration scripts to `api/package.json`**

Add under `scripts`:
```json
"typeorm": "typeorm-ts-node-commonjs -d src/database/data-source.ts",
"migration:generate": "pnpm typeorm migration:generate",
"migration:run": "pnpm typeorm migration:run",
"migration:revert": "pnpm typeorm migration:revert"
```

- [ ] **Step 4: Wire TypeOrmModule into AppModule**

`api/src/app.module.ts` — add to imports:
```ts
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
// ...
TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'postgres',
    url: config.get<string>('DATABASE_URL'),
    autoLoadEntities: true,
    synchronize: false,
  }),
}),
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter api build`
Expected: compiles cleanly.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): TypeORM data source + module + migration scripts"
```

---

## Task 5: Custom Redis health indicator (TDD)

**Files:**
- Create: `api/src/health/redis.health.ts`, `api/src/health/redis.health.spec.ts`
- Add deps: `@nestjs/terminus`, `ioredis`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter api add @nestjs/terminus ioredis`

- [ ] **Step 2: Write the failing test**

`api/src/health/redis.health.spec.ts`:
```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter api test -- redis.health`
Expected: FAIL — cannot find `./redis.health`.

- [ ] **Step 4: Write minimal implementation**

`api/src/health/redis.health.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter api test -- redis.health`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): custom Redis health indicator"
```

---

## Task 6: Health module + controller + Redis provider

**Files:**
- Create: `api/src/health/health.module.ts`, `api/src/health/health.controller.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Create the Redis provider + health module**

`api/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import Redis from 'ioredis';
import { HealthController } from './health.controller';
import { RedisHealthIndicator, REDIS_CLIENT } from './redis.health';

@Module({
  imports: [TerminusModule, ConfigModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: 1 }),
    },
  ],
})
export class HealthModule {}
```

- [ ] **Step 2: Create the controller**

`api/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
```

- [ ] **Step 3: Register HealthModule in AppModule**

`api/src/app.module.ts` — add `HealthModule` to imports:
```ts
import { HealthModule } from './health/health.module';
// imports: [ ..., HealthModule ]
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter api build`
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): health module with liveness + readiness (db + redis)"
```

---

## Task 7: Testcontainers integration harness + readiness integration test

**Files:**
- Create: `api/jest.integration.config.ts`, `api/test/testcontainers.ts`, `api/src/health/health.int-spec.ts`
- Add deps: `@testcontainers/postgresql`, `@testcontainers/redis`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter api add -D @testcontainers/postgresql @testcontainers/redis`

- [ ] **Step 2: Create the integration jest config**

`api/jest.integration.config.ts`:
```ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  testTimeout: 120000,
};

export default config;
```

- [ ] **Step 3: Create the container helper**

`api/test/testcontainers.ts`:
```ts
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
```

- [ ] **Step 4: Write the failing integration test**

`api/src/health/health.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { HealthModule } from './health.module';

describe('Health (integration)', () => {
  let app: INestApplication;
  let infra: TestInfra;

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: infra.databaseUrl,
          autoLoadEntities: true,
          synchronize: false,
        }),
        HealthModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('GET /health/live returns ok', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
  });

  it('GET /health/ready reports db + redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info.redis.status).toBe('up');
  });
});
```

- [ ] **Step 5: Run integration test to verify it passes**

Run: `pnpm --filter api test:int -- health` (Docker must be running)
Expected: PASS (2 tests). First run pulls postgres/redis images.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(api): Testcontainers harness + health readiness integration test"
```

---

## Task 8: Structured logging with pino

**Files:**
- Modify: `api/src/app.module.ts`, `api/src/main.ts`
- Add deps: `nestjs-pino`, `pino-http`, `pino-pretty` (dev)

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter api add nestjs-pino pino-http && pnpm --filter api add -D pino-pretty`

- [ ] **Step 2: Wire LoggerModule into AppModule (first import)**

`api/src/app.module.ts` — add at the top of `imports`:
```ts
import { LoggerModule } from 'nestjs-pino';
// ...
LoggerModule.forRoot({
  pinoHttp: {
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    autoLogging: true,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
}),
```

- [ ] **Step 3: Use the pino logger in bootstrap**

`api/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

- [ ] **Step 4: Verify build + unit tests still green**

Run: `pnpm --filter api build && pnpm --filter api test`
Expected: build OK; unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): structured JSON logging with pino"
```

---

## Task 9: Docker Compose + API Dockerfile + env example

**Files:**
- Create: `api/Dockerfile`, `api/.dockerignore`, `docker-compose.yml`, `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://sleek:sleek@postgres:5432/sleektodo
REDIS_URL=redis://redis:6379
```

- [ ] **Step 2: Create the API Dockerfile (multi-stage, pnpm)**

`api/Dockerfile`:
```dockerfile
# ---- build ----
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY api/package.json ./api/
RUN pnpm install --filter @sleek-todo/api... --frozen-lockfile=false
COPY api ./api
RUN pnpm --filter @sleek-todo/api build

# ---- runtime ----
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json ./
COPY api/package.json ./api/
RUN pnpm install --filter @sleek-todo/api... --prod --frozen-lockfile=false
COPY --from=build /repo/api/dist ./api/dist
WORKDIR /repo/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`api/.dockerignore`:
```
node_modules
dist
coverage
*.spec.ts
*.int-spec.ts
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: sleek
      POSTGRES_PASSWORD: sleek
      POSTGRES_DB: sleektodo
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sleek -d sleektodo"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://sleek:sleek@postgres:5432/sleektodo
      REDIS_URL: redis://redis:6379
    ports: ["3000:3000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

volumes:
  pgdata:
```

- [ ] **Step 4: Verify the stack comes up healthy**

Run: `docker compose up --build -d && sleep 15 && curl -fsS localhost:3000/health/ready`
Expected: JSON with `"status":"ok"` and `database`/`redis` both `up`.
Then: `docker compose down`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: docker-compose stack (postgres + redis + api) with healthchecks"
```

---

## Task 10: CI skeleton (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm --filter @sleek-todo/api build
      - run: pnpm --filter @sleek-todo/api test
      # Integration tests use Testcontainers; Docker is available on ubuntu-latest runners.
      - run: pnpm --filter @sleek-todo/api test:int
```

- [ ] **Step 2: Verify locally what CI runs**

Run: `pnpm install && pnpm lint && pnpm --filter @sleek-todo/api build && pnpm --filter @sleek-todo/api test && pnpm --filter @sleek-todo/api test:int`
Expected: all stages PASS (Docker running for the last one).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "ci: build + lint + unit + integration workflow"
```

---

## Self-Review

- **Spec coverage (Foundation slice of §5/§9/§15):** monorepo ✓ (T1), NestJS layered base ✓ (T2), env validation ✓ (T3), TypeORM + migrations ✓ (T4), Redis ✓ (T5–6), health/readiness probes ✓ (T6–7), Testcontainers integration harness ✓ (T7), pino logging ✓ (T8), docker-compose ✓ (T9), CI ✓ (T10). Deferred to later plans by design: nginx + 2nd API instance (plan 8), OpenTelemetry + Swagger (plan 10), web workspace (plan 9).
- **Placeholder scan:** none — every step has concrete files/code/commands.
- **Type consistency:** `REDIS_CLIENT` token, `RedisHealthIndicator.isHealthy`, `validateEnv`, `startTestInfra`/`TestInfra` are defined once and reused consistently; health endpoints `live`/`ready` match across controller and tests.
