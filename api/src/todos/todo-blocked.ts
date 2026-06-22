import { EntityManager } from 'typeorm';
import { Todo, TodoStatus } from './todo.entity';
import { TodoDependency } from './todo-dependency.entity';

/** True if `todoId` has ≥1 dependency that is not yet COMPLETED. */
export async function isBlocked(m: EntityManager, todoId: string): Promise<boolean> {
  const row = await m
    .createQueryBuilder()
    .select('COUNT(*)', 'c')
    .from(TodoDependency, 'd')
    .innerJoin(Todo, 't', 't.id = d.dependencyId')
    .where('d.dependentId = :id', { id: todoId })
    .andWhere('t.status <> :completed', { completed: TodoStatus.COMPLETED })
    .andWhere('t.deletedAt IS NULL')
    .getRawOne<{ c: string }>();
  return Number.parseInt(row?.c ?? '0', 10) > 0;
}

/** Ids of todos that depend on `todoId` (its dependents). */
export async function dependentIdsOf(m: EntityManager, todoId: string): Promise<string[]> {
  const rows = await m.getRepository(TodoDependency).find({ where: { dependencyId: todoId } });
  return rows.map((r) => r.dependentId);
}

/** Attach a computed `blocked` flag to a todo for the realtime payload. */
export function withBlocked<T extends Todo>(todo: T, blocked: boolean): T & { blocked: boolean } {
  return Object.assign(todo, { blocked });
}
