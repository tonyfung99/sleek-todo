import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { TestAppModule } from '../test-support/test-app.module';

interface AuthResult {
  accessToken: string;
  user: { id: string };
}
interface Todo {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string | null;
}
interface Page {
  items: Todo[];
  nextCursor: string | null;
}

describe('Todos listing (integration: filter/sort/paginate)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let token: string;
  let listId: string;

  async function addTodo(
    name: string,
    fields: Partial<{ priority: string; dueDate: string }> = {},
  ): Promise<Todo> {
    const res = await request(app.getHttpServer())
      .post(`/lists/${listId}/todos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name, ...fields })
      .expect(201);
    return res.body;
  }

  async function patch(id: string, version: number, body: object): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/todos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', String(version))
      .send(body)
      .expect(200);
  }

  function listQuery(qs: string): Promise<Page> {
    return request(app.getHttpServer())
      .get(`/lists/${listId}/todos${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .then((r) => r.body);
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'todos-int-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const auth: AuthResult = (
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'list@x.com', password: 'password123', displayName: 'L' })
        .expect(201)
    ).body;
    token = auth.accessToken;
    listId = (
      await request(app.getHttpServer())
        .post('/lists')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'L' })
        .expect(201)
    ).body.id;

    // Seed: a, b, c, d with assorted priority + due dates.
    const a = await addTodo('alpha', { priority: 'HIGH', dueDate: '2026-07-01T00:00:00.000Z' });
    await addTodo('bravo', { priority: 'LOW', dueDate: '2026-07-03T00:00:00.000Z' });
    const c = await addTodo('charlie', { priority: 'MEDIUM' }); // no due date
    await addTodo('delta', { priority: 'HIGH', dueDate: '2026-07-02T00:00:00.000Z' });
    // mark alpha COMPLETED; soft-delete charlie
    await patch(a.id, 1, { status: 'COMPLETED' });
    await request(app.getHttpServer())
      .delete(`/todos/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('excludes soft-deleted todos', async () => {
    const page = await listQuery('');
    expect(page.items.map((t) => t.name).sort()).toEqual(['alpha', 'bravo', 'delta']);
  });

  it('filters by status', async () => {
    const page = await listQuery('?status=COMPLETED');
    expect(page.items.map((t) => t.name)).toEqual(['alpha']);
  });

  it('filters by priority', async () => {
    const page = await listQuery('?priority=HIGH');
    expect(page.items.map((t) => t.name).sort()).toEqual(['alpha', 'delta']);
  });

  it('filters by dueBefore', async () => {
    const page = await listQuery('?dueBefore=2026-07-02T12:00:00.000Z');
    expect(page.items.map((t) => t.name).sort()).toEqual(['alpha', 'delta']);
  });

  it('sorts by dueDate asc with NULLS LAST', async () => {
    const page = await listQuery('?sort=dueDate&dir=asc');
    // alpha(07-01), delta(07-02), bravo(07-03), [charlie deleted]
    expect(page.items.map((t) => t.name)).toEqual(['alpha', 'delta', 'bravo']);
  });

  it('sorts by name desc', async () => {
    const page = await listQuery('?sort=name&dir=desc');
    expect(page.items.map((t) => t.name)).toEqual(['delta', 'bravo', 'alpha']);
  });

  it('keyset-paginates by name asc across pages with no overlap or gaps', async () => {
    const first = await listQuery('?sort=name&dir=asc&limit=2');
    expect(first.items.map((t) => t.name)).toEqual(['alpha', 'bravo']);
    expect(first.nextCursor).toBeTruthy();
    const second = await listQuery(
      `?sort=name&dir=asc&limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    );
    expect(second.items.map((t) => t.name)).toEqual(['delta']);
    expect(second.nextCursor).toBeNull();
  });
});
