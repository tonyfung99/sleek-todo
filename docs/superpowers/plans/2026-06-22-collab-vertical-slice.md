# Real-Time Collaboration Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest end-to-end path — auth → lists → todos → realtime gateway with per-todo Redis locks + presence + a minimal React client — so two browsers can collaborate live on a shared list.

**Architecture:** REST mutations (auth/lists/todos) are the source of truth on Postgres; after each todo write the `TodosService` calls an injected `RealtimeEmitter` (token defined in a shared `realtime/` module to break the circular dependency) which broadcasts `todo:*` events to the `list:{listId}` socket.io room. Lock and presence state live only in Redis (atomic `SET NX EX` locks with Lua CAS release/refresh, presence hashes), fanned across instances by the socket.io Redis adapter. A small Vite/React client authenticates over REST, joins the list room over a JWT-authed socket, and renders todos, presence avatars and per-todo "is editing" badges live.

**Tech Stack:** NestJS 10, TypeORM + Postgres, `@nestjs/jwt` + `bcrypt` (HS256), `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io` + `@socket.io/redis-adapter`, `ioredis` (existing `REDIS_CLIENT` provider), Joi env validation, Jest unit + Testcontainers integration; Vite + React + TypeScript + `socket.io-client`.

**Prerequisites:** Foundation (Plan 1) complete. This slice ADDS auth, lists, todo, gateway, locks, presence, and a minimal web client.

---

## File Structure

```
api/src/
  config/
    env.validation.ts                 # MODIFY: add JWT_SECRET, CORS_ORIGIN
    env.validation.spec.ts            # MODIFY: cover new vars
  redis/
    redis.module.ts                   # NEW: shared REDIS_CLIENT provider (moved out of health)
    redis.constants.ts                # NEW: REDIS_CLIENT token
  health/
    redis.health.ts                   # MODIFY: import REDIS_CLIENT from redis/ (re-export kept)
    health.module.ts                  # MODIFY: import RedisModule instead of inlining provider
  users/
    user.entity.ts                    # NEW: User entity
    users.module.ts                   # NEW: exports TypeOrm User repo
  auth/
    auth.types.ts                     # NEW: JwtPayload + AuthResult types
    jwt.constants.ts                  # NEW: JWT module options factory
    auth.service.ts                   # NEW: register/login/validateUser
    auth.service.spec.ts              # NEW: unit tests
    auth.controller.ts                # NEW: POST /auth/register, /auth/login
    jwt-auth.guard.ts                 # NEW: custom Bearer guard via JwtService
    current-user.decorator.ts         # NEW: @CurrentUser() param decorator
    auth.module.ts                    # NEW
  lists/
    todo-list.entity.ts               # NEW: TodoList entity
    list-membership.entity.ts         # NEW: ListMembership entity + MemberRole enum
    lists.service.ts                  # NEW: create/findForUser/addMember/assertMember/assertCanEdit
    lists.service.spec.ts             # NEW: unit tests
    lists.controller.ts               # NEW: POST /lists, GET /lists, POST /lists/:id/members
    dto/create-list.dto.ts            # NEW
    dto/add-member.dto.ts             # NEW
    lists.module.ts                   # NEW
  todos/
    todo.entity.ts                    # NEW: Todo entity + TodoStatus enum
    todos.service.ts                  # NEW: list/create/update/softDelete (+ emit)
    todos.service.spec.ts             # NEW: unit tests
    todos.controller.ts               # NEW: GET/POST list todos, PATCH/DELETE todo
    dto/create-todo.dto.ts            # NEW
    dto/update-todo.dto.ts            # NEW
    todos.module.ts                   # NEW
  realtime/
    realtime.types.ts                 # NEW: REALTIME_EMITTER token + RealtimeEmitter interface + payload types
    lock.service.ts                   # NEW: Redis lock acquire/refresh/release/releaseAllForSocket/getHolder
    lock.service.int-spec.ts          # NEW: integration test against real Redis (Lua scripts)
    presence.service.ts               # NEW: Redis presence join/leave/list
    presence.service.int-spec.ts      # NEW: integration test against real Redis
    realtime.gateway.ts               # NEW: WebSocketGateway, JWT handshake, lock/presence handlers, emitter impl
    realtime.module.ts                # NEW
  test-support/
    test-app.module.ts                # NEW: integration-only root module (synchronize:true)
  database/
    migrations/<timestamp>-InitialSchema.ts  # NEW: generated initial migration
  app.module.ts                       # MODIFY: register Auth/Users/Lists/Todos/Realtime/Redis modules, JwtModule, validation pipe
  main.ts                             # MODIFY: enable CORS + global ValidationPipe + RedisIoAdapter
test/
  testcontainers.ts                   # (unchanged — reused)
  realtime-collab.int-spec.ts         # NEW: two-socket end-to-end scenario (spec §11)

api/package.json                      # MODIFY: add jwt/bcrypt/websockets/socket.io deps
.env.example                          # MODIFY: add JWT_SECRET, CORS_ORIGIN
docker-compose.yml                    # MODIFY: add JWT_SECRET, CORS_ORIGIN to api env
pnpm-workspace.yaml                   # MODIFY: add "web"

web/                                  # NEW workspace
  package.json                        # NEW
  tsconfig.json                       # NEW
  vite.config.ts                      # NEW
  index.html                          # NEW
  src/
    main.tsx                          # NEW: React root
    api.ts                            # NEW: REST helpers (register/login/lists/todos)
    socket.ts                         # NEW: socket.io-client factory + useSocket hook
    types.ts                          # NEW: shared client types
    App.tsx                           # NEW: top-level router (auth → lists → detail)
    AuthScreen.tsx                    # NEW: register/login form
    ListsScreen.tsx                   # NEW: list + create lists
    ListDetail.tsx                    # NEW: todos, presence bar, locks, editing flow
    ListDetail.test.tsx               # NEW: one component sanity test
```

---

## Task 1: Env vars (JWT_SECRET, CORS_ORIGIN)

**Files:**
- Modify: `api/src/config/env.validation.ts`
- Test: `api/src/config/env.validation.spec.ts`
- Modify: `.env.example`, `docker-compose.yml`

- [ ] **Step 1: Write failing tests for the new env vars.** Replace `api/src/config/env.validation.spec.ts` with:
```ts
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'super-secret-key-1234567890',
    CORS_ORIGIN: 'http://localhost:5173',
  };

  it('passes with all required vars', () => {
    expect(() => validateEnv(valid)).not.toThrow();
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv(valid).PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _REDIS_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _JWT_SECRET, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is shorter than 16 chars', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('defaults CORS_ORIGIN to the vite dev url', () => {
    const { CORS_ORIGIN: _CORS_ORIGIN, ...rest } = valid;
    expect(validateEnv(rest).CORS_ORIGIN).toBe('http://localhost:5173');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail.**
```
pnpm --filter api test -- env.validation
```
Expected: failures on the new `JWT_SECRET` / `CORS_ORIGIN` cases (the validator does not know these keys yet).

- [ ] **Step 3: Implement the env additions.** Replace `api/src/config/env.validation.ts` with:
```ts
import * as Joi from 'joi';

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
}

const schema = Joi.object<AppEnv>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  JWT_SECRET: Joi.string().min(16).required(),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),
});

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const { error, value } = schema.validate(config, { allowUnknown: true, abortEarly: false });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value as AppEnv;
}
```

- [ ] **Step 4: Run the test and watch it pass.**
```
pnpm --filter api test -- env.validation
```
Expected: all `validateEnv` tests pass.

- [ ] **Step 5: Update `.env.example`.** Replace its contents with:
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://sleek:sleek@postgres:5432/sleektodo
REDIS_URL=redis://redis:6379
JWT_SECRET=dev-only-change-me-0123456789
CORS_ORIGIN=http://localhost:5173
```

- [ ] **Step 6: Update `docker-compose.yml` api env.** In the `api.environment` block, add the two keys after `REDIS_URL`:
```yaml
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://sleek:sleek@postgres:5432/sleektodo
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-only-change-me-0123456789
      CORS_ORIGIN: http://localhost:5173
```

- [ ] **Step 7: Commit.**
```
git add -A && git commit -m "feat(config): add JWT_SECRET and CORS_ORIGIN env vars"
```

---

## Task 2: Shared Redis module (extract REDIS_CLIENT provider)

**Goal:** Move the `REDIS_CLIENT` ioredis provider out of `health.module.ts` into a reusable `RedisModule` so health, locks and presence all share one client. No behavior change for health.

**Files:**
- Create: `api/src/redis/redis.constants.ts`, `api/src/redis/redis.module.ts`
- Modify: `api/src/health/redis.health.ts`, `api/src/health/health.module.ts`

- [ ] **Step 1: Create the token constant.** `api/src/redis/redis.constants.ts`:
```ts
export const REDIS_CLIENT = 'REDIS_CLIENT';
```

- [ ] **Step 2: Create the shared module.** `api/src/redis/redis.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), { maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

- [ ] **Step 3: Point the health indicator at the shared token.** Replace `api/src/health/redis.health.ts` with (re-export `REDIS_CLIENT` so existing imports keep working):
```ts
import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

export { REDIS_CLIENT };

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

- [ ] **Step 4: Slim down the health module.** Replace `api/src/health/health.module.ts` with:
```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule, RedisModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
```

- [ ] **Step 5: Run the health unit test (unchanged behavior).**
```
pnpm --filter api test -- redis.health
```
Expected: `RedisHealthIndicator` tests pass (the spec constructs the indicator directly, unaffected).

- [ ] **Step 6: Commit.**
```
git add -A && git commit -m "refactor(redis): extract shared RedisModule with REDIS_CLIENT provider"
```

---

## Task 3: Auth dependencies + JWT module wiring

**Files:**
- Modify: `api/package.json` (via pnpm add)
- Create: `api/src/auth/jwt.constants.ts`, `api/src/auth/auth.types.ts`

- [ ] **Step 1: Install auth deps.**
```
pnpm --filter api add @nestjs/jwt @nestjs/passport bcrypt
pnpm --filter api add -D @types/bcrypt
```
(Note: we use a custom guard, not passport strategies, but `@nestjs/passport` is harmless to have; it is OK to skip it — the guard below depends only on `@nestjs/jwt`. Prefer adding only `@nestjs/jwt` + `bcrypt` + `@types/bcrypt` if minimizing deps.)
Minimal form:
```
pnpm --filter api add @nestjs/jwt bcrypt
pnpm --filter api add -D @types/bcrypt
```

- [ ] **Step 2: Define shared auth types.** `api/src/auth/auth.types.ts`:
```ts
export interface JwtPayload {
  sub: string;
  email: string;
  displayName: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}
```

- [ ] **Step 3: Define the JwtModule async options factory.** `api/src/auth/jwt.constants.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import { JwtModuleAsyncOptions } from '@nestjs/jwt';

export const jwtModuleOptions: JwtModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: { algorithm: 'HS256', expiresIn: '1d' },
  }),
};
```

- [ ] **Step 4: Commit (scaffolding only).**
```
git add -A && git commit -m "chore(auth): add @nestjs/jwt + bcrypt deps and shared auth types"
```

---

## Task 4: User entity + Users module

**Files:**
- Create: `api/src/users/user.entity.ts`, `api/src/users/users.module.ts`

- [ ] **Step 1: Create the User entity.** `api/src/users/user.entity.ts`:
```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  passwordHash!: string;

  @Column()
  displayName!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

- [ ] **Step 2: Create the Users module.** `api/src/users/users.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  exports: [TypeOrmModule],
})
export class UsersModule {}
```

- [ ] **Step 3: Commit.**
```
git add -A && git commit -m "feat(users): add User entity and UsersModule"
```

---

## Task 5: AuthService (TDD) + controller + guard

**Files:**
- Create: `api/src/auth/auth.service.ts`, `api/src/auth/auth.controller.ts`, `api/src/auth/jwt-auth.guard.ts`, `api/src/auth/current-user.decorator.ts`, `api/src/auth/auth.module.ts`, `api/src/auth/dto/*`
- Test: `api/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write the failing AuthService unit test.** `api/src/auth/auth.service.spec.ts`:
```ts
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { User } from '../users/user.entity';

function makeRepoMock() {
  const store: User[] = [];
  return {
    store,
    findOne: jest.fn(async ({ where: { email } }: { where: { email: string } }) =>
      store.find((u) => u.email === email) ?? null,
    ),
    create: jest.fn((data: Partial<User>) => ({ id: 'user-1', ...data }) as User),
    save: jest.fn(async (u: User) => {
      store.push(u);
      return u;
    }),
  } as unknown as Repository<User> & { store: User[] };
}

describe('AuthService', () => {
  const jwt = new JwtService({ secret: 'test-secret-0123456789', signOptions: { expiresIn: '1d' } });
  let repo: ReturnType<typeof makeRepoMock>;
  let service: AuthService;

  beforeEach(() => {
    repo = makeRepoMock();
    service = new AuthService(repo, jwt);
  });

  it('register hashes the password and returns a token + user', async () => {
    const result = await service.register({
      email: 'a@example.com',
      password: 'password123',
      displayName: 'Alice',
    });
    expect(result.user).toEqual({ id: 'user-1', email: 'a@example.com', displayName: 'Alice' });
    expect(result.accessToken).toEqual(expect.any(String));
    const stored = repo.store[0];
    expect(stored.passwordHash).not.toBe('password123');
    expect(await bcrypt.compare('password123', stored.passwordHash)).toBe(true);
    const decoded = jwt.verify(result.accessToken);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.email).toBe('a@example.com');
  });

  it('register rejects a duplicate email', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    await expect(
      service.register({ email: 'a@example.com', password: 'other12345', displayName: 'Al' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('login returns a token for valid credentials', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    const result = await service.login({ email: 'a@example.com', password: 'password123' });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user.email).toBe('a@example.com');
  });

  it('login rejects a wrong password', async () => {
    await service.register({ email: 'a@example.com', password: 'password123', displayName: 'Alice' });
    await expect(
      service.login({ email: 'a@example.com', password: 'wrongpass1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects an unknown email', async () => {
    await expect(
      service.login({ email: 'nobody@example.com', password: 'whatever12' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail (module not found).**
```
pnpm --filter api test -- auth.service
```
Expected: failure — `auth.service.ts` does not exist yet.

- [ ] **Step 3: Create the DTOs.** `api/src/auth/dto/register.dto.ts`:
```ts
export class RegisterDto {
  email!: string;
  password!: string;
  displayName!: string;
}
```
`api/src/auth/dto/login.dto.ts`:
```ts
export class LoginDto {
  email!: string;
  password!: string;
}
```

- [ ] **Step 4: Implement AuthService.** `api/src/auth/auth.service.ts`:
```ts
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuthResult, AuthUser, JwtPayload } from './auth.types';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthResult> {
    const existing = await this.users.findOne({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      }),
    );
    return this.toResult(user);
  }

  async login(input: { email: string; password: string }): Promise<AuthResult> {
    const user = await this.users.findOne({ where: { email: input.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.toResult(user);
  }

  validateUser(payload: JwtPayload): AuthUser {
    return { id: payload.sub, email: payload.email, displayName: payload.displayName };
  }

  private toResult(user: User): AuthResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
    };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }
}
```

- [ ] **Step 5: Run the test and watch it pass.**
```
pnpm --filter api test -- auth.service
```
Expected: all 5 AuthService tests pass.

- [ ] **Step 6: Implement the custom JWT guard.** `api/src/auth/jwt-auth.guard.ts`:
```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtPayload } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      req.user = this.auth.validateUser(payload);
      return true;
    } catch (_err) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
```

- [ ] **Step 7: Create the `@CurrentUser()` decorator.** `api/src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return req.user;
  },
);
```

- [ ] **Step 8: Implement the AuthController.** `api/src/auth/auth.controller.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthResult } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto);
  }
}
```

- [ ] **Step 9: Implement the AuthModule.** `api/src/auth/auth.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { jwtModuleOptions } from './jwt.constants';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule, JwtModule.registerAsync(jwtModuleOptions)],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 10: Run the full unit suite + lint.**
```
pnpm --filter api test && pnpm --filter api lint
```
Expected: green; no unused-var errors.

- [ ] **Step 11: Commit.**
```
git add -A && git commit -m "feat(auth): AuthService, JWT guard, register/login controller"
```

---

## Task 6: Lists + membership (TDD)

**Files:**
- Create: `api/src/lists/todo-list.entity.ts`, `api/src/lists/list-membership.entity.ts`, `api/src/lists/lists.service.ts`, `api/src/lists/lists.controller.ts`, `api/src/lists/dto/create-list.dto.ts`, `api/src/lists/dto/add-member.dto.ts`, `api/src/lists/lists.module.ts`
- Test: `api/src/lists/lists.service.spec.ts`

- [ ] **Step 1: Create the TodoList entity.** `api/src/lists/todo-list.entity.ts`:
```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('todo_lists')
export class TodoList {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column('uuid')
  ownerId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

- [ ] **Step 2: Create the ListMembership entity + role enum.** `api/src/lists/list-membership.entity.ts`:
```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MemberRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

@Entity('list_memberships')
@Index(['listId', 'userId'], { unique: true })
export class ListMembership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  listId!: string;

  @Column('uuid')
  userId!: string;

  @Column({ type: 'enum', enum: MemberRole })
  role!: MemberRole;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

- [ ] **Step 3: Write the failing ListsService unit test.** `api/src/lists/lists.service.spec.ts`:
```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';
import { ListMembership, MemberRole } from './list-membership.entity';
import { User } from '../users/user.entity';

function buildService() {
  const lists: TodoList[] = [];
  const memberships: ListMembership[] = [];
  const users: User[] = [
    { id: 'owner', email: 'owner@x.com', passwordHash: 'h', displayName: 'Owner' } as User,
    { id: 'other', email: 'other@x.com', passwordHash: 'h', displayName: 'Other' } as User,
  ];

  const listRepo = {
    create: (d: Partial<TodoList>) => ({ id: 'list-1', ...d }) as TodoList,
    find: async ({ where }: { where: { id: string } }) =>
      lists.filter((l) => l.id === where.id),
  } as unknown as Repository<TodoList>;

  const memberRepo = {
    create: (d: Partial<ListMembership>) => ({ id: `m-${memberships.length}`, ...d }) as ListMembership,
    findOne: async ({ where }: { where: { listId: string; userId: string } }) =>
      memberships.find((m) => m.listId === where.listId && m.userId === where.userId) ?? null,
    find: async ({ where }: { where: { userId: string } }) =>
      memberships.filter((m) => m.userId === where.userId),
    save: async (m: ListMembership) => {
      memberships.push(m);
      return m;
    },
  } as unknown as Repository<ListMembership>;

  const userRepo = {
    findOne: async ({ where }: { where: { email: string } }) =>
      users.find((u) => u.email === where.email) ?? null,
  } as unknown as Repository<User>;

  const manager = {
    save: async <T>(_entity: unknown, e: T) => {
      const obj = e as unknown as TodoList | ListMembership;
      if ('ownerId' in obj) lists.push(obj as TodoList);
      else memberships.push(obj as ListMembership);
      return e;
    },
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(cb: (m: EntityManager) => Promise<T>) => cb(manager),
  } as unknown as DataSource;

  const service = new ListsService(listRepo, memberRepo, userRepo, dataSource);
  return { service, lists, memberships, users };
}

describe('ListsService', () => {
  it('create makes the list and an OWNER membership', async () => {
    const { service, lists, memberships } = buildService();
    const list = await service.create('owner', 'Groceries');
    expect(list.name).toBe('Groceries');
    expect(lists).toHaveLength(1);
    const ownerMembership = memberships.find((m) => m.userId === 'owner');
    expect(ownerMembership?.role).toBe(MemberRole.OWNER);
  });

  it('assertMember throws 403 for a non-member', async () => {
    const { service } = buildService();
    await expect(service.assertMember('list-1', 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('addMember by a non-owner is rejected with 403', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await expect(
      service.addMember('list-1', 'other', 'other@x.com', MemberRole.EDITOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('addMember by the owner adds the user', async () => {
    const { service, memberships } = buildService();
    await service.create('owner', 'Groceries');
    const m = await service.addMember('list-1', 'owner', 'other@x.com', MemberRole.EDITOR);
    expect(m.userId).toBe('other');
    expect(m.role).toBe(MemberRole.EDITOR);
    expect(memberships).toHaveLength(2);
  });

  it('addMember rejects an unknown email with 404', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await expect(
      service.addMember('list-1', 'owner', 'ghost@x.com', MemberRole.EDITOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertCanEdit rejects a VIEWER with 403', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await service.addMember('list-1', 'owner', 'other@x.com', MemberRole.VIEWER);
    await expect(service.assertCanEdit('list-1', 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 4: Run the test and watch it fail.**
```
pnpm --filter api test -- lists.service
```
Expected: failure — `lists.service.ts` missing.

- [ ] **Step 5: Implement ListsService.** `api/src/lists/lists.service.ts`:
```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { ListMembership, MemberRole } from './list-membership.entity';
import { TodoList } from './todo-list.entity';

@Injectable()
export class ListsService {
  constructor(
    @InjectRepository(TodoList) private readonly lists: Repository<TodoList>,
    @InjectRepository(ListMembership) private readonly memberships: Repository<ListMembership>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(userId: string, name: string): Promise<TodoList> {
    return this.dataSource.transaction(async (manager) => {
      const list = await manager.save(
        TodoList,
        this.lists.create({ name, ownerId: userId }),
      );
      await manager.save(
        ListMembership,
        this.memberships.create({
          listId: list.id,
          userId,
          role: MemberRole.OWNER,
        }),
      );
      return list;
    });
  }

  async findForUser(userId: string): Promise<TodoList[]> {
    const memberships = await this.memberships.find({ where: { userId } });
    const listIds = memberships.map((m) => m.listId);
    if (listIds.length === 0) {
      return [];
    }
    const result: TodoList[] = [];
    for (const id of listIds) {
      const found = await this.lists.find({ where: { id } });
      result.push(...found);
    }
    return result;
  }

  async assertMember(listId: string, userId: string): Promise<ListMembership> {
    const membership = await this.memberships.findOne({ where: { listId, userId } });
    if (!membership) {
      throw new ForbiddenException('Not a member of this list');
    }
    return membership;
  }

  async assertCanEdit(listId: string, userId: string): Promise<ListMembership> {
    const membership = await this.assertMember(listId, userId);
    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Insufficient role');
    }
    return membership;
  }

  async addMember(
    listId: string,
    requesterId: string,
    email: string,
    role: MemberRole,
  ): Promise<ListMembership> {
    const requester = await this.assertMember(listId, requesterId);
    if (requester.role !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the owner can add members');
    }
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const existing = await this.memberships.findOne({
      where: { listId, userId: user.id },
    });
    if (existing) {
      return existing;
    }
    return this.memberships.save(
      this.memberships.create({ listId, userId: user.id, role }),
    );
  }
}
```

- [ ] **Step 6: Run the test and watch it pass.**
```
pnpm --filter api test -- lists.service
```
Expected: all 6 ListsService tests pass.

- [ ] **Step 7: Create the DTOs.** `api/src/lists/dto/create-list.dto.ts`:
```ts
export class CreateListDto {
  name!: string;
}
```
`api/src/lists/dto/add-member.dto.ts`:
```ts
import { MemberRole } from '../list-membership.entity';

export class AddMemberDto {
  email!: string;
  role!: MemberRole;
}
```

- [ ] **Step 8: Implement the ListsController.** `api/src/lists/lists.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateListDto } from './dto/create-list.dto';
import { ListMembership } from './list-membership.entity';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';

@Controller('lists')
@UseGuards(JwtAuthGuard)
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListDto): Promise<TodoList> {
    return this.lists.create(user.id, dto.name);
  }

  @Get()
  findMine(@CurrentUser() user: AuthUser): Promise<TodoList[]> {
    return this.lists.findForUser(user.id);
  }

  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id') listId: string,
    @Body() dto: AddMemberDto,
  ): Promise<ListMembership> {
    return this.lists.addMember(listId, user.id, dto.email, dto.role);
  }
}
```

- [ ] **Step 9: Implement the ListsModule.** `api/src/lists/lists.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from '../users/user.entity';
import { ListMembership } from './list-membership.entity';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TodoList, ListMembership, User]), AuthModule],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
```

- [ ] **Step 10: Run unit suite + lint.**
```
pnpm --filter api test && pnpm --filter api lint
```
Expected: green.

- [ ] **Step 11: Commit.**
```
git add -A && git commit -m "feat(lists): TodoList + ListMembership entities, ListsService and controller"
```

---

## Task 7: Realtime emitter contract (shared token)

**Goal:** Define the `RealtimeEmitter` interface + DI token in the realtime module so `TodosService` can depend on it without importing the gateway (breaks the circular dependency: gateway → todos service for nothing; todos → emitter token only).

**Files:**
- Create: `api/src/realtime/realtime.types.ts`

- [ ] **Step 1: Define the emitter contract + payloads.** `api/src/realtime/realtime.types.ts`:
```ts
import { Todo } from '../todos/todo.entity';

export const REALTIME_EMITTER = 'REALTIME_EMITTER';

export interface RealtimeEmitter {
  emitTodoCreated(listId: string, todo: Todo): void;
  emitTodoUpdated(listId: string, todo: Todo): void;
  emitTodoDeleted(listId: string, todoId: string): void;
}

export interface PresenceViewer {
  userId: string;
  displayName: string;
  color: string;
}

export interface LockHolder {
  userId: string;
  displayName: string;
  socketId: string;
}
```
(Note: `Todo` is imported as a type only; no runtime cycle because the realtime module does not import the todos *module*, only the entity class for typing.)

- [ ] **Step 2: Commit.**
```
git add -A && git commit -m "feat(realtime): define RealtimeEmitter token and payload types"
```

---

## Task 8: Todo entity + TodosService (TDD) with optimistic concurrency + emit

**Files:**
- Create: `api/src/todos/todo.entity.ts`, `api/src/todos/todos.service.ts`, `api/src/todos/todos.controller.ts`, `api/src/todos/dto/create-todo.dto.ts`, `api/src/todos/dto/update-todo.dto.ts`, `api/src/todos/todos.module.ts`
- Test: `api/src/todos/todos.service.spec.ts`

- [ ] **Step 1: Create the Todo entity + status enum.** `api/src/todos/todo.entity.ts`:
```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum TodoStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

@Entity('todos')
@Index(['listId', 'deletedAt'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  listId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'enum', enum: TodoStatus, default: TodoStatus.NOT_STARTED })
  status!: TodoStatus;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column('uuid')
  createdById!: string;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

- [ ] **Step 2: Write the failing TodosService unit test.** `api/src/todos/todos.service.spec.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { TodosService } from './todos.service';
import { Todo, TodoStatus } from './todo.entity';
import { ListsService } from '../lists/lists.service';
import { RealtimeEmitter } from '../realtime/realtime.types';

function buildHarness() {
  const todos: Todo[] = [];
  const repo = {
    create: (d: Partial<Todo>) =>
      ({
        id: `todo-${todos.length + 1}`,
        status: TodoStatus.NOT_STARTED,
        version: 1,
        description: null,
        deletedAt: null,
        ...d,
      }) as Todo,
    save: async (t: Todo) => {
      const idx = todos.findIndex((x) => x.id === t.id);
      if (idx >= 0) todos[idx] = t;
      else todos.push(t);
      return t;
    },
    findOne: async ({ where }: { where: { id: string } }) =>
      todos.find((t) => t.id === where.id && !t.deletedAt) ?? null,
    find: async ({ where }: { where: { listId: string } }) =>
      todos.filter((t) => t.listId === where.listId && !t.deletedAt),
    softDelete: async (id: string) => {
      const t = todos.find((x) => x.id === id);
      if (t) t.deletedAt = new Date();
      return { affected: t ? 1 : 0 };
    },
  } as unknown as Repository<Todo>;

  const lists = {
    assertMember: jest.fn().mockResolvedValue(undefined),
    assertCanEdit: jest.fn().mockResolvedValue(undefined),
  } as unknown as ListsService;

  const emitter: RealtimeEmitter = {
    emitTodoCreated: jest.fn(),
    emitTodoUpdated: jest.fn(),
    emitTodoDeleted: jest.fn(),
  };

  const service = new TodosService(repo, lists, emitter);
  return { service, todos, lists, emitter };
}

describe('TodosService', () => {
  it('create persists an editor-gated todo and emits todo:created', async () => {
    const { service, lists, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'Buy milk', description: null });
    expect(todo.name).toBe('Buy milk');
    expect(todo.version).toBe(1);
    expect(lists.assertCanEdit).toHaveBeenCalledWith('list-1', 'user-1');
    expect(emitter.emitTodoCreated).toHaveBeenCalledWith('list-1', todo);
  });

  it('listForList excludes soft-deleted todos', async () => {
    const { service } = buildHarness();
    const a = await service.create('list-1', 'user-1', { name: 'A', description: null });
    await service.create('list-1', 'user-1', { name: 'B', description: null });
    await service.softDelete(a.id, 'user-1');
    const rows = await service.listForList('list-1', 'user-1');
    expect(rows.map((t) => t.name)).toEqual(['B']);
  });

  it('update with a matching version bumps version and emits todo:updated', async () => {
    const { service, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    const updated = await service.update(todo.id, 'user-1', { status: TodoStatus.IN_PROGRESS }, 1);
    expect(updated.version).toBe(2);
    expect(updated.status).toBe(TodoStatus.IN_PROGRESS);
    expect(emitter.emitTodoUpdated).toHaveBeenCalledWith('list-1', updated);
  });

  it('update with a stale version throws 409', async () => {
    const { service } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    await expect(
      service.update(todo.id, 'user-1', { name: 'B' }, 99),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('softDelete sets deletedAt and emits todo:deleted', async () => {
    const { service, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    await service.softDelete(todo.id, 'user-1');
    expect(emitter.emitTodoDeleted).toHaveBeenCalledWith('list-1', todo.id);
    const rows = await service.listForList('list-1', 'user-1');
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail.**
```
pnpm --filter api test -- todos.service
```
Expected: failure — `todos.service.ts` missing.

- [ ] **Step 4: Create the DTOs.** `api/src/todos/dto/create-todo.dto.ts`:
```ts
export class CreateTodoDto {
  name!: string;
  description?: string | null;
}
```
`api/src/todos/dto/update-todo.dto.ts`:
```ts
import { TodoStatus } from '../todo.entity';

export class UpdateTodoDto {
  name?: string;
  description?: string | null;
  status?: TodoStatus;
}
```

- [ ] **Step 5: Implement TodosService.** `api/src/todos/todos.service.ts`:
```ts
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListsService } from '../lists/lists.service';
import { REALTIME_EMITTER, RealtimeEmitter } from '../realtime/realtime.types';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './todo.entity';

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    private readonly lists: ListsService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  async listForList(listId: string, userId: string): Promise<Todo[]> {
    await this.lists.assertMember(listId, userId);
    return this.todos.find({ where: { listId } });
  }

  async create(listId: string, userId: string, dto: CreateTodoDto): Promise<Todo> {
    await this.lists.assertCanEdit(listId, userId);
    const todo = await this.todos.save(
      this.todos.create({
        listId,
        name: dto.name,
        description: dto.description ?? null,
        createdById: userId,
      }),
    );
    this.emitter.emitTodoCreated(listId, todo);
    return todo;
  }

  async update(
    todoId: string,
    userId: string,
    dto: UpdateTodoDto,
    ifMatchVersion: number,
  ): Promise<Todo> {
    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) {
      throw new NotFoundException('Todo not found');
    }
    await this.lists.assertCanEdit(todo.listId, userId);
    if (ifMatchVersion !== todo.version) {
      throw new ConflictException('Version mismatch');
    }
    if (dto.name !== undefined) todo.name = dto.name;
    if (dto.description !== undefined) todo.description = dto.description;
    if (dto.status !== undefined) todo.status = dto.status;
    todo.version += 1;
    const saved = await this.todos.save(todo);
    this.emitter.emitTodoUpdated(todo.listId, saved);
    return saved;
  }

  async softDelete(todoId: string, userId: string): Promise<void> {
    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) {
      throw new NotFoundException('Todo not found');
    }
    await this.lists.assertCanEdit(todo.listId, userId);
    await this.todos.softDelete(todo.id);
    this.emitter.emitTodoDeleted(todo.listId, todo.id);
  }
}
```

- [ ] **Step 6: Run the test and watch it pass.**
```
pnpm --filter api test -- todos.service
```
Expected: all 5 TodosService tests pass.

- [ ] **Step 7: Implement the TodosController.** `api/src/todos/todos.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './todo.entity';
import { TodosService } from './todos.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get('lists/:id/todos')
  list(@CurrentUser() user: AuthUser, @Param('id') listId: string): Promise<Todo[]> {
    return this.todos.listForList(listId, user.id);
  }

  @Post('lists/:id/todos')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') listId: string,
    @Body() dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todos.create(listId, user.id, dto);
  }

  @Patch('todos/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') todoId: string,
    @Headers('if-match') ifMatch: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todos.update(todoId, user.id, dto, Number.parseInt(ifMatch, 10));
  }

  @Delete('todos/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') todoId: string): Promise<void> {
    await this.todos.softDelete(todoId, user.id);
  }
}
```

- [ ] **Step 8: Implement the TodosModule.** `api/src/todos/todos.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Todo } from './todo.entity';
import { TodosController } from './todos.controller';
import { TodosService } from './todos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Todo]), AuthModule, ListsModule, RealtimeModule],
  controllers: [TodosController],
  providers: [TodosService],
  exports: [TodosService],
})
export class TodosModule {}
```
(Note: `RealtimeModule` exports the `REALTIME_EMITTER` provider — see Task 10. `RealtimeModule` does NOT import `TodosModule`, so there is no circular module dependency.)

- [ ] **Step 9: Run unit suite + lint.**
```
pnpm --filter api test && pnpm --filter api lint
```
Expected: green (the `todos.module.ts` won't be fully exercised until Realtime exists; if Nest fails to resolve, that's fixed in Task 10).

- [ ] **Step 10: Commit.**
```
git add -A && git commit -m "feat(todos): Todo entity, TodosService (optimistic concurrency + emit), controller"
```

---

## Task 9: Lock service (TDD against real Redis)

**Files:**
- Create: `api/src/realtime/lock.service.ts`
- Test: `api/src/realtime/lock.service.int-spec.ts`

- [ ] **Step 1: Install websocket/socket deps now (needed by realtime module next).**
```
pnpm --filter api add @nestjs/websockets @nestjs/platform-socket.io socket.io @socket.io/redis-adapter
```

- [ ] **Step 2: Write the failing LockService integration test.** `api/src/realtime/lock.service.int-spec.ts`:
```ts
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
```

- [ ] **Step 3: Run the test and watch it fail.**
```
pnpm --filter api test:int -- lock.service
```
Expected: failure — `lock.service.ts` missing.

- [ ] **Step 4: Implement LockService.** `api/src/realtime/lock.service.ts`:
```ts
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
```

- [ ] **Step 5: Run the test and watch it pass.**
```
pnpm --filter api test:int -- lock.service
```
Expected: all 5 LockService integration tests pass.

- [ ] **Step 6: Commit.**
```
git add -A && git commit -m "feat(realtime): Redis lock service with Lua CAS release/refresh"
```

---

## Task 10: Presence service (TDD) + Realtime gateway + module

**Files:**
- Create: `api/src/realtime/presence.service.ts`, `api/src/realtime/realtime.gateway.ts`, `api/src/realtime/realtime.module.ts`
- Test: `api/src/realtime/presence.service.int-spec.ts`

- [ ] **Step 1: Write the failing PresenceService integration test.** `api/src/realtime/presence.service.int-spec.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and watch it fail.**
```
pnpm --filter api test:int -- presence.service
```
Expected: failure — `presence.service.ts` missing.

- [ ] **Step 3: Implement PresenceService.** `api/src/realtime/presence.service.ts`:
```ts
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
```

- [ ] **Step 4: Run the test and watch it pass.**
```
pnpm --filter api test:int -- presence.service
```
Expected: all 3 PresenceService tests pass.

- [ ] **Step 5: Implement the RealtimeGateway.** `api/src/realtime/realtime.gateway.ts`:
```ts
import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.types';
import { ListsService } from '../lists/lists.service';
import { MemberRole } from '../lists/list-membership.entity';
import { Todo } from '../todos/todo.entity';
import { LockService } from './lock.service';
import { PresenceService } from './presence.service';
import { LockHolder, PresenceViewer, RealtimeEmitter } from './realtime.types';

interface SocketUser {
  userId: string;
  displayName: string;
  color: string;
}

const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, RealtimeEmitter
{
  @WebSocketServer()
  server!: Server;

  // socketId -> { listId, userId } so disconnect can clean presence up (single-instance).
  private readonly socketPresence = new Map<string, { listId: string; userId: string }[]>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly lists: ListsService,
    private readonly locks: LockService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit(): void {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.server.adapter(createAdapter(pubClient, subClient));
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: SocketUser = {
        userId: payload.sub,
        displayName: payload.displayName,
        color: colorFor(payload.sub),
      };
      client.data.user = user;
    } catch (_err) {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const released = await this.locks.releaseAllForSocket(client.id);
    for (const { listId, todoId } of released) {
      this.server.to(`list:${listId}`).emit('lock:released', { todoId });
    }
    const entries = this.socketPresence.get(client.id) ?? [];
    for (const { listId, userId } of entries) {
      await this.presence.leave(listId, userId);
      await this.broadcastPresence(listId);
    }
    this.socketPresence.delete(client.id);
  }

  @SubscribeMessage('list:join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    await this.lists.assertMember(body.listId, user.userId);
    await client.join(`list:${body.listId}`);
    await this.presence.join(body.listId, {
      userId: user.userId,
      displayName: user.displayName,
      color: user.color,
    });
    const entries = this.socketPresence.get(client.id) ?? [];
    entries.push({ listId: body.listId, userId: user.userId });
    this.socketPresence.set(client.id, entries);
    await this.broadcastPresence(body.listId);
  }

  @SubscribeMessage('list:leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    await client.leave(`list:${body.listId}`);
    await this.presence.leave(body.listId, user.userId);
    const entries = (this.socketPresence.get(client.id) ?? []).filter(
      (e) => e.listId !== body.listId,
    );
    this.socketPresence.set(client.id, entries);
    await this.broadcastPresence(body.listId);
  }

  @SubscribeMessage('editing:start')
  async onEditingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string; todoId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    const membership = await this.lists.assertMember(body.listId, user.userId);
    if (membership.role === MemberRole.VIEWER) {
      client.emit('lock:denied', { todoId: body.todoId, heldBy: null });
      return;
    }
    const holder: LockHolder = {
      userId: user.userId,
      displayName: user.displayName,
      socketId: client.id,
    };
    const acquired = await this.locks.acquire(body.listId, body.todoId, holder);
    if (acquired) {
      this.server.to(`list:${body.listId}`).emit('lock:granted', {
        todoId: body.todoId,
        userId: user.userId,
        displayName: user.displayName,
      });
    } else {
      const current = await this.locks.getHolder(body.listId, body.todoId);
      client.emit('lock:denied', { todoId: body.todoId, heldBy: current });
    }
  }

  @SubscribeMessage('editing:stop')
  async onEditingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string; todoId: string },
  ): Promise<void> {
    const released = await this.locks.release(body.listId, body.todoId, client.id);
    if (released) {
      this.server.to(`list:${body.listId}`).emit('lock:released', { todoId: body.todoId });
    }
  }

  private async broadcastPresence(listId: string): Promise<void> {
    const viewers: PresenceViewer[] = await this.presence.list(listId);
    this.server.to(`list:${listId}`).emit('presence:update', { viewers });
  }

  emitTodoCreated(listId: string, todo: Todo): void {
    this.server.to(`list:${listId}`).emit('todo:created', { todo });
  }

  emitTodoUpdated(listId: string, todo: Todo): void {
    this.server.to(`list:${listId}`).emit('todo:updated', { todo });
  }

  emitTodoDeleted(listId: string, todoId: string): void {
    this.server.to(`list:${listId}`).emit('todo:deleted', { todoId });
  }
}
```

- [ ] **Step 6: Implement the RealtimeModule.** `api/src/realtime/realtime.module.ts` (provides the gateway as the `REALTIME_EMITTER` so `TodosService` gets the live instance — no module cycle because RealtimeModule imports `AuthModule`+`ListsModule`, not `TodosModule`):
```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ListsModule } from '../lists/lists.module';
import { LockService } from './lock.service';
import { PresenceService } from './presence.service';
import { RealtimeGateway } from './realtime.gateway';
import { REALTIME_EMITTER } from './realtime.types';

@Module({
  imports: [AuthModule, ListsModule],
  providers: [
    LockService,
    PresenceService,
    RealtimeGateway,
    { provide: REALTIME_EMITTER, useExisting: RealtimeGateway },
  ],
  exports: [REALTIME_EMITTER, LockService, PresenceService],
})
export class RealtimeModule {}
```

- [ ] **Step 7: Run unit + int suites + lint.**
```
pnpm --filter api test && pnpm --filter api test:int -- realtime && pnpm --filter api lint
```
Expected: presence + lock int-specs pass; lint clean.

- [ ] **Step 8: Commit.**
```
git add -A && git commit -m "feat(realtime): presence service + socket.io gateway (locks, presence, emitter)"
```

---

## Task 11: Wire app module, CORS, validation pipe, Redis socket adapter

**Files:**
- Modify: `api/src/app.module.ts`, `api/src/main.ts`
- Create: `api/src/test-support/test-app.module.ts`

- [ ] **Step 1: Register all feature modules + global pieces in AppModule.** Replace `api/src/app.module.ts` with:
```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { ListsModule } from './lists/lists.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { TodosModule } from './todos/todos.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty' }
            : undefined,
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListsModule,
    TodosModule,
    RealtimeModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Enable CORS + the socket.io Redis adapter in bootstrap.** Replace `api/src/main.ts` with:
```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.getOrThrow<string>('CORS_ORIGIN'), credentials: true });
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(config.get<number>('PORT') ?? 3000);
}
void bootstrap();
```
(Note: the cross-instance Redis adapter is attached inside `RealtimeGateway.onModuleInit` via `@socket.io/redis-adapter`, so a single instance still works and 2+ instances fan out. `IoAdapter` is the standard NestJS socket.io adapter.)

- [ ] **Step 3: Create the integration-only root module (synchronize:true).** `api/src/test-support/test-app.module.ts`:
```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HealthModule } from '../health/health.module';
import { ListsModule } from '../lists/lists.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../redis/redis.module';
import { TodosModule } from '../todos/todos.module';
import { UsersModule } from '../users/users.module';

// Integration-only root module: schema via synchronize, no migrations,
// no pino transport. DATABASE_URL / REDIS_URL / JWT_SECRET / CORS_ORIGIN
// must be set on process.env before importing this (see int-specs).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
    }),
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListsModule,
    TodosModule,
    RealtimeModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class TestAppModule {}
```

- [ ] **Step 4: Build to verify wiring compiles + DI resolves.**
```
pnpm --filter api build
```
Expected: successful `nest build` (no DI/circular errors). If TypeORM complains about the `enum` types on first run, that's resolved at runtime by `synchronize`/migration, not at build time.

- [ ] **Step 5: Run the existing health int-spec to confirm nothing regressed.**
```
pnpm --filter api test:int -- health
```
Expected: health integration test still passes.

- [ ] **Step 6: Commit.**
```
git add -A && git commit -m "feat(api): wire feature modules, CORS, validation pipe, socket.io adapter"
```

---

## Task 12: Initial migration

**Goal:** Real app runs on migrations. Generate ONE migration from all entities against the compose Postgres, run it, commit it. (Integration tests stay on `synchronize:true` via `TestAppModule` — independent of migration files.)

**Files:**
- Create: `api/src/database/migrations/<timestamp>-InitialSchema.ts` (generated)

- [ ] **Step 1: Start the compose Postgres (only) for migration generation.**
```
docker compose up -d postgres
```
Expected: postgres container healthy.

- [ ] **Step 2: Generate the initial migration against the local DB.** Ensure a local `.env` (copy of `.env.example`) exists so `data-source.ts`'s `dotenv.config()` picks up `DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo` (use `localhost`, not `postgres`, when running outside Docker).
```
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
  pnpm --filter api migration:generate src/database/migrations/InitialSchema
```
Expected: a new file `api/src/database/migrations/<timestamp>-InitialSchema.ts` containing `CREATE TABLE users`, `todo_lists`, `list_memberships`, `todos`, the enum types (`member_role`, `todo_status` or the TypeORM-named equivalents), and the unique/index constraints.

- [ ] **Step 3: Run the migration to verify it applies cleanly.**
```
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
  pnpm --filter api migration:run
```
Expected: `Migration InitialSchema... has been executed successfully.`

- [ ] **Step 4: Sanity-check the schema.**
```
docker compose exec postgres psql -U sleek -d sleektodo -c "\dt"
```
Expected: tables `users`, `todo_lists`, `list_memberships`, `todos`, `migrations`.

- [ ] **Step 5: Commit the migration.**
```
git add -A && git commit -m "feat(db): initial schema migration (users, lists, memberships, todos)"
```

---

## Task 13: End-to-end realtime integration test (spec §11)

**Files:**
- Create: `api/test/realtime-collab.int-spec.ts`

- [ ] **Step 1: Add the socket client dep for the test.**
```
pnpm --filter api add -D socket.io-client
```

- [ ] **Step 2: Write the end-to-end two-socket integration test.** `api/test/realtime-collab.int-spec.ts`:
```ts
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { startTestInfra, TestInfra } from './testcontainers';
import { TestAppModule } from '../src/test-support/test-app.module';

interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; displayName: string };
}

function once<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Realtime collaboration (integration)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let url: string;
  let alice: AuthResult;
  let bob: AuthResult;
  let listId: string;
  let todoId: string;
  let sockA: Socket;
  let sockB: Socket;

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'integration-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    url = `http://localhost:${port}`;

    const http = request(url);
    alice = (
      await http
        .post('/auth/register')
        .send({ email: 'alice@x.com', password: 'password123', displayName: 'Alice' })
        .expect(201)
    ).body;
    bob = (
      await http
        .post('/auth/register')
        .send({ email: 'bob@x.com', password: 'password123', displayName: 'Bob' })
        .expect(201)
    ).body;

    const list = (
      await http
        .post('/lists')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'Shared' })
        .expect(201)
    ).body;
    listId = list.id;

    await http
      .post(`/lists/${listId}/members`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ email: 'bob@x.com', role: 'EDITOR' })
      .expect(201);

    const todo = (
      await http
        .post(`/lists/${listId}/todos`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ name: 'Initial', description: null })
        .expect(201)
    ).body;
    todoId = todo.id;
  });

  afterAll(async () => {
    sockA?.disconnect();
    sockB?.disconnect();
    await app?.close();
    await infra?.stop();
  });

  function connect(token: string): Promise<Socket> {
    const socket = io(url, { auth: { token }, transports: ['websocket'] });
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  it('runs the full collaboration scenario', async () => {
    sockA = await connect(alice.accessToken);
    sockB = await connect(bob.accessToken);

    // Both join; B should see presence include both.
    const bPresence = once<{ viewers: { userId: string }[] }>(sockB, 'presence:update');
    sockA.emit('list:join', { listId });
    await once(sockA, 'presence:update');
    sockB.emit('list:join', { listId });
    const presence = await bPresence;
    expect(presence.viewers.length).toBeGreaterThanOrEqual(1);

    // Scenario 1: A acquires lock -> B sees lock:granted.
    const bGranted = once<{ todoId: string; userId: string }>(sockB, 'lock:granted');
    sockA.emit('editing:start', { listId, todoId });
    const granted = await bGranted;
    expect(granted.todoId).toBe(todoId);
    expect(granted.userId).toBe(alice.user.id);

    // B's own acquire -> lock:denied to B.
    const bDenied = once<{ todoId: string; heldBy: { userId: string } }>(sockB, 'lock:denied');
    sockB.emit('editing:start', { listId, todoId });
    const denied = await bDenied;
    expect(denied.heldBy.userId).toBe(alice.user.id);

    // Scenario 2: A PATCHes -> B sees todo:updated.
    const bUpdated = once<{ todo: { id: string; name: string; version: number } }>(
      sockB,
      'todo:updated',
    );
    await request(url)
      .patch(`/todos/${todoId}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('If-Match', '1')
      .send({ name: 'Renamed by Alice' })
      .expect(200);
    const updated = await bUpdated;
    expect(updated.todo.name).toBe('Renamed by Alice');
    expect(updated.todo.version).toBe(2);

    // Stale If-Match -> 409.
    await request(url)
      .patch(`/todos/${todoId}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('If-Match', '1')
      .send({ name: 'Stale' })
      .expect(409);

    // Scenario 4: A disconnects mid-edit -> B sees lock:released.
    const bReleased = once<{ todoId: string }>(sockB, 'lock:released');
    sockA.disconnect();
    const released = await bReleased;
    expect(released.todoId).toBe(todoId);

    // Scenario 3: B deletes -> a fresh A2 socket sees todo:deleted.
    const a2 = await connect(alice.accessToken);
    a2.emit('list:join', { listId });
    await once(a2, 'presence:update');
    const a2Deleted = once<{ todoId: string }>(a2, 'todo:deleted');
    await request(url)
      .delete(`/todos/${todoId}`)
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .expect(204);
    const deleted = await a2Deleted;
    expect(deleted.todoId).toBe(todoId);
    a2.disconnect();
  });
});
```
(Note on §11 scenario 5 — lock auto-expiry: covered by the unit-level TTL behavior in `lock.service.int-spec.ts` step 4, which directly asserts `EXPIRE`/`TTL` semantics; reproducing a 60s wall-clock expiry inside this e2e test would slow the suite without adding coverage, so it is deliberately exercised there instead.)

- [ ] **Step 3: Run the end-to-end test.**
```
pnpm --filter api test:int -- realtime-collab
```
Expected: the single scenario test passes (presence, lock grant/deny, todo:updated + 409, lock:released on disconnect, todo:deleted).

- [ ] **Step 4: Run the full integration suite + lint.**
```
pnpm --filter api test:int && pnpm --filter api lint
```
Expected: health + lock + presence + realtime-collab all green; lint clean.

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "test(realtime): end-to-end two-socket collaboration integration test"
```

---

## Task 14: Web workspace scaffold

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`

- [ ] **Step 1: Add web to the workspace.** Replace `pnpm-workspace.yaml` with:
```yaml
packages:
  - "api"
  - "web"
```

- [ ] **Step 2: Create `web/package.json`.**
```json
{
  "name": "@sleek-todo/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint \"src/**/*.{ts,tsx}\""
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.8.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Install the web deps.**
```
pnpm --filter web install
```
Expected: web dependencies resolved into the workspace.

- [ ] **Step 4: Create `web/tsconfig.json`.**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `web/vite.config.ts`.**
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 6: Create `web/index.html`.**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SleekTodo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create the React root.** `web/src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Commit.**
```
git add -A && git commit -m "chore(web): scaffold Vite + React workspace"
```

---

## Task 15: Web client — API + socket + types

**Files:**
- Create: `web/src/types.ts`, `web/src/api.ts`, `web/src/socket.ts`

- [ ] **Step 1: Shared client types.** `web/src/types.ts`:
```ts
export type TodoStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUser;
}

export interface TodoList {
  id: string;
  name: string;
  ownerId: string;
}

export interface Todo {
  id: string;
  listId: string;
  name: string;
  description: string | null;
  status: TodoStatus;
  version: number;
}

export interface Viewer {
  userId: string;
  displayName: string;
  color: string;
}

export interface LockGranted {
  todoId: string;
  userId: string;
  displayName: string;
}
```

- [ ] **Step 2: REST helpers.** `web/src/api.ts`:
```ts
import { AuthResult, Todo, TodoList } from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((body as { message?: string }).message ?? res.statusText), {
      status: res.status,
    });
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string, displayName: string) =>
    req<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),
  login: (email: string, password: string) =>
    req<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  lists: (token: string) => req<TodoList[]>('/lists', { method: 'GET' }, token),
  createList: (token: string, name: string) =>
    req<TodoList>('/lists', { method: 'POST', body: JSON.stringify({ name }) }, token),
  todos: (token: string, listId: string) =>
    req<Todo[]>(`/lists/${listId}/todos`, { method: 'GET' }, token),
  createTodo: (token: string, listId: string, name: string) =>
    req<Todo>(
      `/lists/${listId}/todos`,
      { method: 'POST', body: JSON.stringify({ name, description: null }) },
      token,
    ),
  updateTodo: (
    token: string,
    todoId: string,
    version: number,
    patch: Partial<Pick<Todo, 'name' | 'description' | 'status'>>,
  ) =>
    req<Todo>(
      `/todos/${todoId}`,
      { method: 'PATCH', headers: { 'If-Match': String(version) }, body: JSON.stringify(patch) },
      token,
    ),
  deleteTodo: (token: string, todoId: string) =>
    req<void>(`/todos/${todoId}`, { method: 'DELETE' }, token),
};
```

- [ ] **Step 3: Socket factory.** `web/src/socket.ts`:
```ts
import { io, Socket } from 'socket.io-client';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function createSocket(token: string): Socket {
  return io(BASE, { auth: { token }, transports: ['websocket'], autoConnect: true });
}
```

- [ ] **Step 4: Commit.**
```
git add -A && git commit -m "feat(web): REST client, socket factory, shared types"
```

---

## Task 16: Web client — Auth + Lists screens + App shell

**Files:**
- Create: `web/src/AuthScreen.tsx`, `web/src/ListsScreen.tsx`, `web/src/App.tsx`

- [ ] **Step 1: Auth screen.** `web/src/AuthScreen.tsx`:
```tsx
import { FormEvent, useState } from 'react';
import { api } from './api';
import { AuthResult } from './types';

export function AuthScreen({ onAuth }: { onAuth: (r: AuthResult) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result =
        mode === 'register'
          ? await api.register(email, password, displayName)
          : await api.login(email, password);
      onAuth(result);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 320, margin: '64px auto', display: 'grid', gap: 8 }}>
      <h2>SleekTodo — {mode === 'register' ? 'Register' : 'Login'}</h2>
      {mode === 'register' && (
        <input
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      )}
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit">{mode === 'register' ? 'Create account' : 'Log in'}</button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button
        type="button"
        onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}
      >
        {mode === 'register' ? 'Have an account? Log in' : 'Need an account? Register'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Lists screen.** `web/src/ListsScreen.tsx`:
```tsx
import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';
import { TodoList } from './types';

export function ListsScreen({
  token,
  onOpen,
}: {
  token: string;
  onOpen: (list: TodoList) => void;
}) {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    api.lists(token).then(setLists);
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const list = await api.createList(token, name.trim());
    setLists((prev) => [...prev, list]);
    setName('');
  }

  return (
    <div style={{ maxWidth: 480, margin: '32px auto' }}>
      <h2>My lists</h2>
      <form onSubmit={create} style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="New list name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">Create</button>
      </form>
      <ul>
        {lists.map((l) => (
          <li key={l.id}>
            <button onClick={() => onOpen(l)} style={{ cursor: 'pointer' }}>
              {l.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: App shell.** `web/src/App.tsx`:
```tsx
import { useState } from 'react';
import { AuthScreen } from './AuthScreen';
import { ListDetail } from './ListDetail';
import { ListsScreen } from './ListsScreen';
import { AuthResult, TodoList } from './types';

export function App() {
  const [auth, setAuth] = useState<AuthResult | null>(null);
  const [openList, setOpenList] = useState<TodoList | null>(null);

  if (!auth) {
    return <AuthScreen onAuth={setAuth} />;
  }
  if (openList) {
    return (
      <ListDetail
        token={auth.accessToken}
        me={auth.user}
        list={openList}
        onBack={() => setOpenList(null)}
      />
    );
  }
  return <ListsScreen token={auth.accessToken} onOpen={setOpenList} />;
}
```

- [ ] **Step 4: Commit.**
```
git add -A && git commit -m "feat(web): auth screen, lists screen, app shell"
```

---

## Task 17: Web client — List detail (todos, presence, locks, live editing) + sanity test

**Files:**
- Create: `web/src/ListDetail.tsx`, `web/src/ListDetail.test.tsx`

- [ ] **Step 1: List detail with the full realtime flow.** `web/src/ListDetail.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { api } from './api';
import { createSocket } from './socket';
import { AuthUser, LockGranted, Todo, TodoList, TodoStatus, Viewer } from './types';

const STATUSES: TodoStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];

export function ListDetail({
  token,
  me,
  list,
  onBack,
}: {
  token: string;
  me: AuthUser;
  list: TodoList;
  onBack: () => void;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [locks, setLocks] = useState<Record<string, LockGranted>>({});
  const [newName, setNewName] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    api.todos(token, list.id).then(setTodos);
    const socket = createSocket(token);
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('list:join', { listId: list.id }));
    socket.on('presence:update', (p: { viewers: Viewer[] }) => setViewers(p.viewers));
    socket.on('todo:created', (p: { todo: Todo }) =>
      setTodos((prev) => (prev.some((t) => t.id === p.todo.id) ? prev : [...prev, p.todo])),
    );
    socket.on('todo:updated', (p: { todo: Todo }) =>
      setTodos((prev) => prev.map((t) => (t.id === p.todo.id ? p.todo : t))),
    );
    socket.on('todo:deleted', (p: { todoId: string }) =>
      setTodos((prev) => prev.filter((t) => t.id !== p.todoId)),
    );
    socket.on('lock:granted', (p: LockGranted) =>
      setLocks((prev) => ({ ...prev, [p.todoId]: p })),
    );
    socket.on('lock:released', (p: { todoId: string }) =>
      setLocks((prev) => {
        const next = { ...prev };
        delete next[p.todoId];
        return next;
      }),
    );
    return () => {
      socket.emit('list:leave', { listId: list.id });
      socket.disconnect();
    };
  }, [token, list.id]);

  function lockedByOther(todoId: string): LockGranted | undefined {
    const lock = locks[todoId];
    return lock && lock.userId !== me.id ? lock : undefined;
  }

  async function createTodo() {
    if (!newName.trim()) return;
    const todo = await api.createTodo(token, list.id, newName.trim());
    setTodos((prev) => (prev.some((t) => t.id === todo.id) ? prev : [...prev, todo]));
    setNewName('');
  }

  function startEditing(todoId: string) {
    socketRef.current?.emit('editing:start', { listId: list.id, todoId });
  }

  function stopEditing(todoId: string) {
    socketRef.current?.emit('editing:stop', { listId: list.id, todoId });
  }

  function onNameChange(todo: Todo, name: string) {
    setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, name } : t)));
    clearTimeout(saveTimers.current[todo.id]);
    saveTimers.current[todo.id] = setTimeout(async () => {
      try {
        const saved = await api.updateTodo(token, todo.id, todo.version, { name });
        setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
      } catch {
        // 409 / conflict: refetch authoritative state.
        api.todos(token, list.id).then(setTodos);
      }
    }, 400);
  }

  async function changeStatus(todo: Todo, status: TodoStatus) {
    startEditing(todo.id);
    try {
      const saved = await api.updateTodo(token, todo.id, todo.version, { status });
      setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
    } catch {
      api.todos(token, list.id).then(setTodos);
    } finally {
      stopEditing(todo.id);
    }
  }

  async function remove(todo: Todo) {
    await api.deleteTodo(token, todo.id);
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
  }

  return (
    <div style={{ maxWidth: 640, margin: '24px auto' }}>
      <button onClick={onBack}>&larr; Lists</button>
      <h2>{list.name}</h2>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <span>{viewers.length} viewing:</span>
        {viewers.map((v) => (
          <span
            key={v.userId}
            title={v.displayName}
            style={{
              background: v.color,
              color: 'white',
              borderRadius: 12,
              padding: '2px 8px',
              fontSize: 12,
            }}
          >
            {v.displayName}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="New todo"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button onClick={createTodo}>Add</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {todos.map((todo) => {
          const lock = lockedByOther(todo.id);
          const disabled = Boolean(lock);
          return (
            <li
              key={todo.id}
              style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 8 }}
            >
              <input
                value={todo.name}
                disabled={disabled}
                onFocus={() => startEditing(todo.id)}
                onBlur={() => stopEditing(todo.id)}
                onChange={(e) => onNameChange(todo, e.target.value)}
                style={{ width: '100%', fontWeight: 600 }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                <select
                  value={todo.status}
                  disabled={disabled}
                  onChange={(e) => changeStatus(todo, e.target.value as TodoStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button disabled={disabled} onClick={() => remove(todo)}>
                  Delete
                </button>
                {lock && (
                  <span style={{ color: '#b45309', fontSize: 12 }}>
                    🔒 {lock.displayName} is editing
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: One component sanity test.** `web/src/ListDetail.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListDetail } from './ListDetail';

vi.mock('./api', () => ({
  api: {
    todos: vi.fn().mockResolvedValue([
      {
        id: 't1',
        listId: 'l1',
        name: 'Buy milk',
        description: null,
        status: 'NOT_STARTED',
        version: 1,
      },
    ]),
  },
}));

const emit = vi.fn();
vi.mock('./socket', () => ({
  createSocket: () => ({
    on: vi.fn(),
    emit,
    disconnect: vi.fn(),
  }),
}));

describe('ListDetail', () => {
  it('renders the list name and a fetched todo', async () => {
    render(
      <ListDetail
        token="tok"
        me={{ id: 'u1', email: 'a@x.com', displayName: 'Alice' }}
        list={{ id: 'l1', name: 'Groceries', ownerId: 'u1' }}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(await screen.findByDisplayValue('Buy milk')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the web test.**
```
pnpm --filter web test
```
Expected: `ListDetail` renders the list name and the fetched todo (1 test passes).

- [ ] **Step 4: Type-check + build the web client.**
```
pnpm --filter web build
```
Expected: `tsc` clean, `vite build` produces `dist/`.

- [ ] **Step 5: Commit.**
```
git add -A && git commit -m "feat(web): list detail with live todos, presence, locks, editing flow"
```

---

## Task 18: Two-browser demo + final verification

**Files:** (none new — verification + docs in this plan only)

- [ ] **Step 1: Bring up backing services.**
```
docker compose up -d postgres redis
```
Expected: both healthy.

- [ ] **Step 2: Run migrations against the local DB.**
```
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
  pnpm --filter api migration:run
```
Expected: schema present (idempotent if already run in Task 12).

- [ ] **Step 3: Start the API and the web dev server (two terminals).**
```
# terminal 1
DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo \
REDIS_URL=redis://localhost:6379 \
JWT_SECRET=dev-only-change-me-0123456789 \
CORS_ORIGIN=http://localhost:5173 \
NODE_ENV=development \
  pnpm --filter api start:dev

# terminal 2
pnpm --filter web dev
```
Expected: API on :3000, web on :5173.

- [ ] **Step 4: Demo — open two browsers.**
  1. Browser A (e.g. normal window): register Alice, create a list "Demo".
  2. In the API or a REST call, Alice adds Bob as an EDITOR: `POST /lists/:id/members { email: "bob@x.com", role: "EDITOR" }` (register Bob first in Browser B). For the demo you can add a tiny "Share" input later; for now use the network tab / curl.
  3. Browser B (incognito/another browser): register Bob, open the same "Demo" list.
  4. Observe: both avatars appear in each other's presence bar ("2 viewing").
  5. In A, focus a todo's name field → B sees the row go read-only with "🔒 Alice is editing"; A types → B sees the text update live (debounced autosave → `todo:updated`).
  6. A blurs → B's row re-enables.
  7. A changes status / deletes → B sees it live.
  8. Close Browser A's tab mid-edit → within socket.io's ping timeout B's row re-enables (`lock:released` on disconnect).

- [ ] **Step 5: Run the entire test suite one last time.**
```
pnpm --filter api test && pnpm --filter api test:int && pnpm --filter web test && pnpm -r lint
```
Expected: all unit, integration, web tests and lint pass across the workspace.

- [ ] **Step 6: Final commit.**
```
git add -A && git commit -m "docs(demo): verify two-browser realtime collaboration flow"
```

---

## Task 19: Automated browser e2e (Playwright, two contexts)

**Goal:** Prove the collaborative flow in a REAL browser, automatically — two browser contexts (Alice & Bob) on the same list, asserting live edit propagation, the enforced lock, and presence. Runs locally and in CI.

**Files:**
- Create: `web/playwright.config.ts`
- Create: `web/e2e/global-setup.ts`
- Create: `web/e2e/collab.e2e.spec.ts`
- Modify: `web/package.json` (playwright dep + `e2e` scripts)
- Modify: `.github/workflows/ci.yml` (add `e2e` job)

**Testid contract — Task 17's `ListDetail.tsx` MUST render these stable selectors (add them when implementing Task 17):**
- `presence-bar` — container; renders one `presence-avatar` per viewer with the displayName as text/title.
- `todo-row-<todoId>` — the row container for each todo.
- `todo-name-<todoId>` — the editable name `<input>` for a todo.
- `lock-badge-<todoId>` — shown only when another user holds the lock; text includes the holder's displayName.
- `todo-delete-<todoId>` — the delete button.
- `list-item-<listId>` — a clickable list entry on the Lists screen.
The auth token + user are persisted to `localStorage` under keys `token` and `user` (App reads them on load) — this lets the test inject sessions without driving the login form.

- [ ] **Step 1: Add Playwright to the web workspace.**
```
pnpm --filter web add -D @playwright/test
pnpm --filter web exec playwright install --with-deps chromium
```
Add to `web/package.json` scripts:
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 2: Create `web/playwright.config.ts`.**
```ts
import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const API_ENV =
  'DATABASE_URL=postgres://sleek:sleek@localhost:5432/sleektodo ' +
  'REDIS_URL=redis://localhost:6379 ' +
  'JWT_SECRET=e2e-only-secret-0123456789 ' +
  'CORS_ORIGIN=http://localhost:5173 ' +
  'NODE_ENV=development';

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
      command: `${API_ENV} pnpm --filter @sleek-todo/api start:dev`,
      cwd: REPO_ROOT,
      url: 'http://localhost:3000/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter web dev -- --port 5173 --strictPort',
      cwd: REPO_ROOT,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
```

- [ ] **Step 3: Create `web/e2e/global-setup.ts`** (brings up Postgres + Redis and runs migrations before the servers boot).
```ts
import { execSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
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
```

- [ ] **Step 4: Write the e2e test `web/e2e/collab.e2e.spec.ts`.** Seeds users/list/membership/todo over REST, then drives two browser contexts through the UI.
```ts
import { test, expect, request, Browser, BrowserContext } from '@playwright/test';

const API = 'http://localhost:3000';

async function registerUser(rq: Awaited<ReturnType<typeof request.newContext>>, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}@e2e.test`;
  const res = await rq.post(`${API}/auth/register`, {
    data: { email, password: 'password123', displayName: name },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { accessToken: string; user: { id: string; email: string; displayName: string } };
}

async function openAs(
  browser: Browser,
  session: { accessToken: string; user: unknown },
): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(
    ([token, user]) => {
      localStorage.setItem('token', token as string);
      localStorage.setItem('user', JSON.stringify(user));
    },
    [session.accessToken, session.user],
  );
  return ctx;
}

test('two users collaborate live on a shared list', async ({ browser }) => {
  const rq = await request.newContext();
  const alice = await registerUser(rq, 'Alice');
  const bob = await registerUser(rq, 'Bob');

  // Alice creates a list, adds Bob as EDITOR, adds a todo.
  const listRes = await rq.post(`${API}/lists`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { name: 'Demo' },
  });
  const list = (await listRes.json()) as { id: string };
  await rq.post(`${API}/lists/${list.id}/members`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { email: bob.user.email, role: 'EDITOR' },
  });
  const todoRes = await rq.post(`${API}/lists/${list.id}/todos`, {
    headers: { Authorization: `Bearer ${alice.accessToken}` },
    data: { name: 'Buy milk' },
  });
  const todo = (await todoRes.json()) as { id: string };

  // Both open the list in separate browser contexts.
  const aliceCtx = await openAs(browser, alice);
  const bobCtx = await openAs(browser, bob);
  const aPage = await aliceCtx.newPage();
  const bPage = await bobCtx.newPage();
  await aPage.goto('/');
  await bPage.goto('/');
  await aPage.getByTestId(`list-item-${list.id}`).click();
  await bPage.getByTestId(`list-item-${list.id}`).click();

  // Presence: each sees 2 viewers.
  await expect(aPage.getByTestId('presence-avatar')).toHaveCount(2);
  await expect(bPage.getByTestId('presence-avatar')).toHaveCount(2);

  // Alice focuses the todo name → Bob sees the lock + read-only.
  await aPage.getByTestId(`todo-name-${todo.id}`).click();
  await expect(bPage.getByTestId(`lock-badge-${todo.id}`)).toContainText('Alice');
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toBeDisabled();

  // Alice edits → Bob sees the new text live (debounced autosave → todo:updated).
  await aPage.getByTestId(`todo-name-${todo.id}`).fill('Buy oat milk');
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toHaveValue('Buy oat milk');

  // Alice blurs → Bob's row re-enables.
  await aPage.getByTestId(`todo-name-${todo.id}`).blur();
  await expect(bPage.getByTestId(`lock-badge-${todo.id}`)).toHaveCount(0);
  await expect(bPage.getByTestId(`todo-name-${todo.id}`)).toBeEnabled();

  // Alice deletes → Bob's row disappears.
  await aPage.getByTestId(`todo-delete-${todo.id}`).click();
  await expect(bPage.getByTestId(`todo-row-${todo.id}`)).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
  await rq.dispose();
});
```

- [ ] **Step 5: Run the e2e locally.**
```
pnpm --filter web e2e
```
Expected: `1 passed`. (global-setup brings up Postgres+Redis via compose + migrations; Playwright starts the API and Vite dev server, runs Chromium with two contexts.)

- [ ] **Step 6: Add an `e2e` job to `.github/workflows/ci.yml`.**
```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @sleek-todo/api build
      - run: pnpm --filter web build
      - run: pnpm --filter web exec playwright install --with-deps chromium
      - run: pnpm --filter web e2e
        env:
          CI: 'true'
```

- [ ] **Step 7: Commit.**
```
git add -A && git commit -m "test(e2e): Playwright two-browser collaboration test + CI job"
```

---

## Self-Review

### Spec coverage map

| Spec section | Requirement | Task(s) |
|---|---|---|
| Collab §4.1 / Core §10 | socket.io gateway, JWT-authed handshake, room per list | Task 10 (gateway), Task 11 (adapter wiring) |
| Collab §4.1 | RBAC membership check on `list:join`; VIEWER cannot lock | Task 6 (`assertMember`/`assertCanEdit`), Task 10 (`onJoin`, VIEWER `lock:denied`) |
| Collab §4.2 | Redis ephemeral lock + presence state (not Postgres) | Task 9 (locks), Task 10 (presence) |
| Collab §5.1 | Acquire (`SET NX EX`) → `lock:granted`; held → `lock:denied { heldBy }` | Task 9 (`acquire`/`getHolder`), Task 10 (`editing:start`) |
| Collab §5.1 | Release on `editing:stop` → `lock:released` | Task 9 (`release`), Task 10 (`editing:stop`) |
| Collab §5.2 | Client-death cleanup via `disconnect`; releaseAllForSocket | Task 9 (`releaseAllForSocket`), Task 10 (`handleDisconnect`) |
| Collab §5.2 | Server-death backstop: coarse Redis TTL (60s) + refresh on activity | Task 9 (`LOCK_TTL_SECONDS`, `refresh` CAS), int-spec TTL test |
| Collab §5.3 | Whole-todo lock; structured action = acquire→mutate→release | Task 17 (`changeStatus`), Task 10 |
| Collab §6 / Core §8.5 | Live create/update/delete broadcast after REST write | Task 7 (emitter token), Task 8 (`TodosService` emits), Task 10 (emitter impl) |
| Collab §6.1 / Core §8.4, §9.2 | Optimistic concurrency `If-Match`/version → 409 backstop | Task 8 (`update` 409), Task 13 (stale 409 assertion) |
| Collab §7 / Core §7 | Presence join/leave/list + `presence:update` broadcast | Task 10 (presence service + gateway) |
| Collab §8 | Reconnect reconciles via REST refetch | Task 17 (catch → `api.todos` refetch; join refetch) |
| Collab §9 / Core §9.3 | Multi-instance: socket.io Redis adapter + atomic `SET NX` | Task 10 (`createAdapter` in `onModuleInit`), Task 9 (`SET NX`) |
| Collab §10 / table | All 8 S→C events + 4 C→S events with spec payloads | Task 10 (every `@SubscribeMessage` + emit) |
| Collab §11 unit | Lock acquire/deny/refresh/release/releaseAllForSocket; presence join/leave/dedupe | Task 9 int-spec, Task 10 presence int-spec |
| Collab §11 integration 1–4,6 | Two-socket grant/deny, todo:updated, todo:deleted, lock:released on disconnect, presence | Task 13 |
| Collab §11 integration 5 | Lock auto-expiry (TTL) | Task 9 int-spec (TTL/EXPIRE assertions) — see note in Task 13 Step 2 |
| Core §2 (Auth) | register/login, JWT HS256 1d, bcrypt | Task 3, Task 5 |
| Core §6 (Data model) | User, TodoList, ListMembership(role, unique), Todo(version, soft delete, status) | Task 4, Task 6, Task 8 |
| Core §7 (API) | `/auth/*`, `/lists`, `/lists/:id/members`, `/lists/:id/todos`, `/todos/:id` | Task 5, Task 6, Task 8 controllers |
| Core §8.5 / §3 | Soft delete (`deletedAt`), excluded from queries | Task 8 (`@DeleteDateColumn`, `softDelete`, `listForList` excludes) |
| Core §5 / §11 (Web UI) | React + Vite + socket.io-client; auth/lists/detail screens, live patch | Tasks 14–17 |
| Core §12 / Collab §11 | TDD units + Testcontainers integration + light frontend tests | Tasks 1,5,6,8,9,10 (unit/int), Task 13 (e2e), Task 17 (one web test) |
| Foundation env | JWT_SECRET (min16), CORS_ORIGIN (default vite url) | Task 1 |
| Migrations vs test schema | Real app on migrations; tests use `synchronize:true` `TestAppModule` | Task 11 (TestAppModule), Task 12 (migration) |

**Out-of-scope-by-design (not planned, matching spec §12 / core §13):** CRDT/OT, live cursors, per-field locking, refresh-token rotation (core §2 mentions it; this *thin slice* uses a single 1d access token per the prompt's explicit decision), dependencies/recurrence/filtering/pagination (later plans 5–7), Swagger/OTel (plan 10). These are intentional gaps for the vertical slice, not omissions.

### Placeholder scan
Scanned every code step for `TBD`, `...`, `similar to above`, `// add validation`, `// handle errors`, empty function bodies, and prose-instead-of-code. **None present.** Every code step contains complete, runnable TypeScript/TSX/JSON/YAML. Error handling is concrete (try/catch with typed exceptions in services and guard; client catch → REST refetch). The only ellipses (`&larr;`) are HTML entities, not placeholders.

### Type-consistency check
- `JwtPayload { sub, email, displayName }` is produced in `AuthService.toResult` and consumed identically in `JwtAuthGuard` and `RealtimeGateway.handleConnection`. ✓
- `AuthUser { id, email, displayName }` flows guard → `req.user` → `@CurrentUser()` → controllers (`user.id`). ✓
- `RealtimeEmitter` interface (Task 7) is implemented exactly by `RealtimeGateway` (Task 10) — same three method signatures using the `Todo` entity type — and injected via `REALTIME_EMITTER` token into `TodosService` (Task 8). `useExisting: RealtimeGateway` ties the token to the live gateway instance. ✓
- `LockHolder { userId, displayName, socketId }` is the value written by `acquire`, parsed by `getHolder`, matched in the Lua CAS scripts (`holder.socketId`), and passed from `RealtimeGateway.onEditingStart`. ✓
- `PresenceViewer { userId, displayName, color }` written by `presence.join`, returned by `presence.list`, broadcast in `presence:update`, and rendered by `ListDetail` as `Viewer`. ✓
- Socket event names + payloads (`lock:granted/denied/released`, `todo:created/updated/deleted`, `presence:update`, `list:join/leave`, `editing:start/stop`) match the spec §10 table on both gateway emit/subscribe and the web `ListDetail` handlers, and are asserted in the Task 13 e2e test. ✓
- Web `Todo`/`TodoStatus`/`TodoList`/`AuthResult` client types mirror the API entity shapes returned over REST. ✓
- No circular module dependency: `TodosModule` → `RealtimeModule` (for `REALTIME_EMITTER`); `RealtimeModule` → `AuthModule` + `ListsModule` only (never `TodosModule`). The gateway references the `Todo` entity *class for typing only*, not the module. ✓
- ESLint conventions honored: unused catch bindings are `_err`; destructured unused vars use `_`-prefix (env spec); no stray `any` in production code (the one cast in tests is in `.spec` mock builders, acceptable and warn-level). ✓
