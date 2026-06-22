import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { TestAppModule } from '../test-support/test-app.module';

interface Todo {
  id: string;
  name: string;
  status: string;
  version: number;
}

describe('Dependencies (integration: cycle, gate, blocked filter)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  let token: string;
  let listId: string;

  function http() {
    return request(app.getHttpServer());
  }
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function addTodo(name: string): Promise<Todo> {
    return (await http().post(`/lists/${listId}/todos`).set(auth()).send({ name }).expect(201))
      .body;
  }
  async function patch(id: string, version: number, body: object, expected = 200) {
    return http().patch(`/todos/${id}`).set(auth()).set('If-Match', String(version)).send(body).expect(expected);
  }

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'deps-int-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    token = (
      await http()
        .post('/auth/register')
        .send({ email: 'deps@x.com', password: 'password123', displayName: 'D' })
        .expect(201)
    ).body.accessToken;
    listId = (await http().post('/lists').set(auth()).send({ name: 'D' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('adds a dependency and rejects a cycle', async () => {
    const a = await addTodo('A');
    const b = await addTodo('B');
    // A depends on B
    await http()
      .post(`/todos/${a.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: b.id })
      .expect(201);
    // B depends on A would create a cycle → 409
    await http()
      .post(`/todos/${b.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: a.id })
      .expect(409);
  });

  it('rejects a self-dependency', async () => {
    const a = await addTodo('Self');
    await http()
      .post(`/todos/${a.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: a.id })
      .expect(400);
  });

  it('blocks IN_PROGRESS until all dependencies are COMPLETED', async () => {
    const task = await addTodo('Task');
    const prereq = await addTodo('Prereq');
    await http()
      .post(`/todos/${task.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: prereq.id })
      .expect(201);

    // prereq not completed → starting task is blocked (422)
    await patch(task.id, task.version, { status: 'IN_PROGRESS' }, 422);

    // complete the prereq, then task can start
    await patch(prereq.id, prereq.version, { status: 'COMPLETED' }, 200);
    await patch(task.id, task.version, { status: 'IN_PROGRESS' }, 200);
  });

  it('blocks COMPLETED (not just IN_PROGRESS) until all dependencies are COMPLETED', async () => {
    const task = await addTodo('Finish');
    const prereq = await addTodo('Prep');
    await http()
      .post(`/todos/${task.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: prereq.id })
      .expect(201);

    // prereq not completed → completing task directly is rejected (422)
    await patch(task.id, task.version, { status: 'COMPLETED' }, 422);

    // complete the prereq, then the task can be completed
    await patch(prereq.id, prereq.version, { status: 'COMPLETED' }, 200);
    await patch(task.id, task.version, { status: 'COMPLETED' }, 200);
  });

  it('filters by dependencyStatus=blocked / unblocked', async () => {
    // fresh list to isolate
    const lid = (await http().post('/lists').set(auth()).send({ name: 'F' }).expect(201)).body.id;
    const mk = async (n: string) =>
      (await http().post(`/lists/${lid}/todos`).set(auth()).send({ name: n }).expect(201)).body as Todo;
    const dependent = await mk('dependent');
    const blocker = await mk('blocker'); // stays NOT_STARTED
    await mk('free');
    await http()
      .post(`/todos/${dependent.id}/dependencies`)
      .set(auth())
      .send({ dependencyId: blocker.id })
      .expect(201);

    const blocked = (
      await http().get(`/lists/${lid}/todos?dependencyStatus=blocked`).set(auth()).expect(200)
    ).body.items.map((t: Todo) => t.name);
    expect(blocked).toEqual(['dependent']);

    const unblocked = (
      await http().get(`/lists/${lid}/todos?dependencyStatus=unblocked`).set(auth()).expect(200)
    ).body.items.map((t: Todo) => t.name).sort();
    expect(unblocked).toEqual(['blocker', 'free']);
  });
});
