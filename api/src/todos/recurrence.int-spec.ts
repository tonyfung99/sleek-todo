import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { TestAppModule } from '../test-support/test-app.module';

interface Todo {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
  version: number;
  recurrenceUnit: string | null;
}

describe('Recurrence (integration)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let token: string;
  let listId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function listTodos(): Promise<Todo[]> {
    return (await http().get(`/lists/${listId}/todos?sort=createdAt`).set(auth()).expect(200)).body
      .items;
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'recur-int-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    token = (
      await http()
        .post('/auth/register')
        .send({ email: 'recur@x.com', password: 'password123', displayName: 'R' })
        .expect(201)
    ).body.accessToken;
    listId = (await http().post('/lists').set(auth()).send({ name: 'R' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('rejects a recurring todo without a due date', async () => {
    await http()
      .post(`/lists/${listId}/todos`)
      .set(auth())
      .send({ name: 'bad', recurrenceUnit: 'WEEK', recurrenceInterval: 1 })
      .expect(400);
  });

  it('completing a weekly recurring todo spawns the next occurrence +7 days', async () => {
    const created: Todo = (
      await http()
        .post(`/lists/${listId}/todos`)
        .set(auth())
        .send({
          name: 'water plants',
          dueDate: '2026-03-02T08:00:00.000Z',
          recurrenceUnit: 'WEEK',
          recurrenceInterval: 1,
        })
        .expect(201)
    ).body;

    await http()
      .patch(`/todos/${created.id}`)
      .set(auth())
      .set('If-Match', String(created.version))
      .send({ status: 'COMPLETED' })
      .expect(200);

    const todos = await listTodos();
    const original = todos.find((t) => t.id === created.id);
    const next = todos.find((t) => t.name === 'water plants' && t.id !== created.id);

    expect(original?.status).toBe('COMPLETED');
    expect(next).toBeDefined();
    expect(next?.status).toBe('NOT_STARTED');
    expect(next?.dueDate).toBe('2026-03-09T08:00:00.000Z');
    expect(next?.recurrenceUnit).toBe('WEEK');
  });

  it('is idempotent: a stale re-complete does not spawn a duplicate occurrence', async () => {
    const created: Todo = (
      await http()
        .post(`/lists/${listId}/todos`)
        .set(auth())
        .send({
          name: 'standup',
          dueDate: '2026-03-02T08:00:00.000Z',
          recurrenceUnit: 'DAY',
          recurrenceInterval: 1,
        })
        .expect(201)
    ).body;

    // First completion (version 1) succeeds and spawns one occurrence.
    await http()
      .patch(`/todos/${created.id}`)
      .set(auth())
      .set('If-Match', '1')
      .send({ status: 'COMPLETED' })
      .expect(200);

    // Re-completing is an idempotent no-op (already COMPLETED) — crucially it does
    // NOT spawn a second occurrence (design spec §9.2 #2).
    await http()
      .patch(`/todos/${created.id}`)
      .set(auth())
      .set('If-Match', '1')
      .send({ status: 'COMPLETED' })
      .expect(200);

    const occurrences = (await listTodos()).filter((t) => t.name === 'standup');
    expect(occurrences).toHaveLength(2); // original COMPLETED + exactly one next
  });

  it('a non-recurring todo does not spawn an occurrence on completion', async () => {
    const created: Todo = (
      await http()
        .post(`/lists/${listId}/todos`)
        .set(auth())
        .send({ name: 'one-off', dueDate: '2026-03-02T08:00:00.000Z' })
        .expect(201)
    ).body;
    await http()
      .patch(`/todos/${created.id}`)
      .set(auth())
      .set('If-Match', String(created.version))
      .send({ status: 'COMPLETED' })
      .expect(200);
    const occurrences = (await listTodos()).filter((t) => t.name === 'one-off');
    expect(occurrences).toHaveLength(1);
  });
});
