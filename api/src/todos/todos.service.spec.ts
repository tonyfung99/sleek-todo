import { ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TodosService } from './todos.service';
import { Todo, TodoPriority, TodoStatus } from './todo.entity';
import { ListsService } from '../lists/lists.service';
import { RealtimeEmitter } from '../realtime/realtime.types';

function buildHarness() {
  const todos: Todo[] = [];
  const repo = {
    create: (d: Partial<Todo>) =>
      ({
        id: `todo-${todos.length + 1}`,
        status: TodoStatus.NOT_STARTED,
        priority: TodoPriority.MEDIUM,
        version: 1,
        description: null,
        dueDate: null,
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

  // These unit tests exercise non-IN_PROGRESS paths only, so the SERIALIZABLE
  // transaction (which needs a real DataSource) is never entered.
  const dataSource = {} as unknown as DataSource;

  const service = new TodosService(repo, dataSource, lists, emitter);
  return { service, todos, lists, emitter };
}

describe('TodosService', () => {
  it('create persists an editor-gated todo (priority defaults to MEDIUM) and emits todo:created', async () => {
    const { service, lists, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'Buy milk', description: null });
    expect(todo.name).toBe('Buy milk');
    expect(todo.version).toBe(1);
    expect(todo.priority).toBe(TodoPriority.MEDIUM);
    expect(lists.assertCanEdit).toHaveBeenCalledWith('list-1', 'user-1');
    expect(emitter.emitTodoCreated).toHaveBeenCalledWith('list-1', todo);
  });

  it('create accepts an explicit priority and due date', async () => {
    const { service } = buildHarness();
    const todo = await service.create('list-1', 'user-1', {
      name: 'Ship it',
      priority: TodoPriority.HIGH,
      dueDate: '2026-07-01T00:00:00.000Z',
    });
    expect(todo.priority).toBe(TodoPriority.HIGH);
    expect(todo.dueDate).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });

  it('update with a matching version bumps version and emits todo:updated', async () => {
    const { service, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    // COMPLETED is not dependency-gated, so it stays on the optimistic (non-tx) path.
    const updated = await service.update(todo.id, 'user-1', { status: TodoStatus.COMPLETED }, 1);
    expect(updated.version).toBe(2);
    expect(updated.status).toBe(TodoStatus.COMPLETED);
    expect(emitter.emitTodoUpdated).toHaveBeenCalledWith('list-1', updated);
  });

  it('update can change priority and due date', async () => {
    const { service } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A' });
    const updated = await service.update(
      todo.id,
      'user-1',
      { priority: TodoPriority.LOW, dueDate: '2026-08-15T00:00:00.000Z' },
      1,
    );
    expect(updated.priority).toBe(TodoPriority.LOW);
    expect(updated.dueDate).toEqual(new Date('2026-08-15T00:00:00.000Z'));
  });

  it('update with a stale version throws 409', async () => {
    const { service } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    await expect(
      service.update(todo.id, 'user-1', { name: 'B' }, 99),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('softDelete sets deletedAt and emits todo:deleted', async () => {
    const { service, todos, emitter } = buildHarness();
    const todo = await service.create('list-1', 'user-1', { name: 'A', description: null });
    await service.softDelete(todo.id, 'user-1');
    expect(emitter.emitTodoDeleted).toHaveBeenCalledWith('list-1', todo.id);
    expect(todos.find((t) => t.id === todo.id)?.deletedAt).toBeInstanceOf(Date);
  });
});
