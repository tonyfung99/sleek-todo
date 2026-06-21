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
