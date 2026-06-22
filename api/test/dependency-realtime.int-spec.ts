import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { startTestInfra, TestInfra } from './testcontainers';
import { TestAppModule } from '../src/test-support/test-app.module';

interface AuthResult {
  accessToken: string;
  user: { id: string };
}
interface UpdatedPayload {
  todo: { id: string; blocked?: boolean; status: string };
}

function waitForUpdate(
  socket: Socket,
  todoId: string,
  predicate: (p: UpdatedPayload) => boolean,
  timeoutMs = 4000,
): Promise<UpdatedPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for todo:updated for ${todoId}`)),
      timeoutMs,
    );
    const handler = (p: UpdatedPayload) => {
      if (p.todo.id === todoId && predicate(p)) {
        clearTimeout(timer);
        socket.off('todo:updated', handler);
        resolve(p);
      }
    };
    socket.on('todo:updated', handler);
  });
}

describe('Dependency blocked flag is live (integration)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let url: string;
  let token: string;
  let listId: string;
  let sock: Socket;

  const http = () => request(url);
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'dep-rt-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address();
    url = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 3000}`;

    const a: AuthResult = (
      await http()
        .post('/auth/register')
        .send({ email: 'deprt@x.com', password: 'password123', displayName: 'D' })
        .expect(201)
    ).body;
    token = a.accessToken;
    listId = (await http().post('/lists').set(auth()).send({ name: 'L' }).expect(201)).body.id;
  });

  afterAll(async () => {
    sock?.disconnect();
    await app?.close();
    await infra?.stop();
  });

  it('completing a dependency emits a live blocked:false for its dependent', async () => {
    const task = (
      await http().post(`/lists/${listId}/todos`).set(auth()).send({ name: 'Ship' }).expect(201)
    ).body;
    const prereq = (
      await http().post(`/lists/${listId}/todos`).set(auth()).send({ name: 'QA' }).expect(201)
    ).body;

    // Connect a socket and join the list room.
    sock = io(url, { auth: { token }, transports: ['websocket'] });
    await new Promise<void>((res, rej) => {
      sock.on('connect', () => res());
      sock.on('connect_error', rej);
    });
    sock.emit('list:join', { listId });
    await new Promise((r) => setTimeout(r, 200));

    // Add the dependency → Ship becomes blocked; we should see blocked:true for Ship.
    const shipBlocked = waitForUpdate(sock, task.id, (p) => p.todo.blocked === true);
    await http()
      .post(`/todos/${task.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: prereq.id })
      .expect(201);
    expect((await shipBlocked).todo.blocked).toBe(true);

    // Complete QA → Ship should be unblocked LIVE (blocked:false), no refetch.
    const shipUnblocked = waitForUpdate(sock, task.id, (p) => p.todo.blocked === false);
    await http()
      .patch(`/todos/${prereq.id}`)
      .set(auth())
      .set('If-Match', '1')
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect((await shipUnblocked).todo.blocked).toBe(false);

    // Re-open QA (NOT_STARTED) → Ship is blocked again, live.
    const reblocked = waitForUpdate(sock, task.id, (p) => p.todo.blocked === true);
    await http()
      .patch(`/todos/${prereq.id}`)
      .set(auth())
      .set('If-Match', '2')
      .send({ status: 'NOT_STARTED' })
      .expect(200);
    expect((await reblocked).todo.blocked).toBe(true);
  });
});
