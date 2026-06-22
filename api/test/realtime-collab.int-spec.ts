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
