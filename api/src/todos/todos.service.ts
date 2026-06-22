import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ListsService } from '../lists/lists.service';
import { runSerializable } from '../common/serializable';
import { REALTIME_EMITTER, RealtimeEmitter } from '../realtime/realtime.types';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosQueryDto } from './dto/list-todos-query.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { nextDueDate } from './recurrence';
import { dependentIdsOf, isBlocked, withBlocked } from './todo-blocked';
import { Todo, TodoPriority, TodoStatus } from './todo.entity';
import {
  SORT_CONFIG,
  decodeCursor,
  encodeCursor,
  keysetClause,
} from './todo-keyset';

export type TodoView = Todo & { blocked: boolean };

export interface PaginatedTodos {
  items: TodoView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

// EXISTS subquery: the todo has ≥1 dependency that is not COMPLETED.
const BLOCKED_EXISTS = `EXISTS (
  SELECT 1 FROM todo_dependencies d
  JOIN todos dt ON dt.id = d."dependencyId"
  WHERE d."dependentId" = t.id AND dt.status <> 'COMPLETED' AND dt."deletedAt" IS NULL
)`;

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lists: ListsService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  async listForList(
    listId: string,
    userId: string,
    query: ListTodosQueryDto = {},
  ): Promise<PaginatedTodos> {
    await this.lists.assertMember(listId, userId);

    const sortField = query.sort ?? 'createdAt';
    const dir = query.dir ?? 'asc';
    const limit = query.limit ?? DEFAULT_LIMIT;
    const config = SORT_CONFIG[sortField];

    const qb = this.todos
      .createQueryBuilder('t')
      .where('t.listId = :listId', { listId })
      .andWhere('t.deletedAt IS NULL');

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.priority) qb.andWhere('t.priority = :priority', { priority: query.priority });
    if (query.dueBefore) qb.andWhere('t.dueDate <= :dueBefore', { dueBefore: query.dueBefore });
    if (query.dueAfter) qb.andWhere('t.dueDate >= :dueAfter', { dueAfter: query.dueAfter });
    if (query.dependencyStatus === 'blocked') qb.andWhere(BLOCKED_EXISTS);
    if (query.dependencyStatus === 'unblocked') qb.andWhere(`NOT ${BLOCKED_EXISTS}`);

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        const { sql, params } = keysetClause(config, dir, cursor);
        qb.andWhere(sql, params);
      }
    }

    const orderDir = dir === 'asc' ? 'ASC' : 'DESC';
    qb.addSelect(BLOCKED_EXISTS, 'blocked')
      .orderBy(config.expr, orderDir, 'NULLS LAST')
      .addOrderBy('t.id', orderDir)
      .take(limit + 1);

    const { entities, raw } = await qb.getRawAndEntities();
    const rows: TodoView[] = entities.map((e, i) => {
      const blocked = raw[i]?.blocked === true || raw[i]?.blocked === 'true';
      return Object.assign(e, { blocked }) as TodoView;
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(config.value(last), last.id) : null;

    return { items, nextCursor };
  }

  async create(listId: string, userId: string, dto: CreateTodoDto): Promise<Todo> {
    await this.lists.assertCanEdit(listId, userId);
    const recurrenceUnit = dto.recurrenceUnit ?? null;
    const recurrenceInterval = recurrenceUnit ? dto.recurrenceInterval ?? 1 : null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (recurrenceUnit && !dueDate) {
      throw new BadRequestException('Recurring todos require a due date');
    }
    const todo = await this.todos.save(
      this.todos.create({
        listId,
        name: dto.name,
        description: dto.description ?? null,
        dueDate,
        priority: dto.priority ?? TodoPriority.MEDIUM,
        recurrenceUnit,
        recurrenceInterval,
        createdById: userId,
      }),
    );
    // A brand-new todo has no dependencies yet → not blocked.
    this.emitter.emitTodoCreated(listId, withBlocked(todo, false));
    return todo;
  }

  async update(
    todoId: string,
    userId: string,
    dto: UpdateTodoDto,
    ifMatchVersion: number,
  ): Promise<Todo> {
    if (dto.status === TodoStatus.IN_PROGRESS) {
      return this.startTodo(todoId, userId, dto, ifMatchVersion);
    }
    if (dto.status === TodoStatus.COMPLETED) {
      return this.completeTodo(todoId, userId, dto, ifMatchVersion);
    }

    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) throw new NotFoundException('Todo not found');
    await this.lists.assertCanEdit(todo.listId, userId);
    if (ifMatchVersion !== todo.version) throw new ConflictException('Version mismatch');
    this.applyPatch(todo, dto);
    if (dto.status !== undefined) todo.status = dto.status;
    this.normalizeRecurrence(todo);
    todo.version += 1;
    const saved = await this.todos.save(todo);
    await this.emitUpdated(saved);
    return saved;
  }

  // IN_PROGRESS is dependency-gated and write-skew-prone → SERIALIZABLE + retry (§9.2 #3).
  private async startTodo(
    todoId: string,
    userId: string,
    dto: UpdateTodoDto,
    ifMatchVersion: number,
  ): Promise<Todo> {
    const saved = await runSerializable(this.dataSource, async (m) => {
      const repo = m.getRepository(Todo);
      const todo = await repo.findOne({ where: { id: todoId } });
      if (!todo) throw new NotFoundException('Todo not found');
      await this.lists.assertCanEdit(todo.listId, userId);
      if (ifMatchVersion !== todo.version) throw new ConflictException('Version mismatch');
      if (await isBlocked(m, todoId)) {
        throw new UnprocessableEntityException(
          'Blocked: every dependency must be COMPLETED before starting',
        );
      }
      this.applyPatch(todo, dto);
      this.normalizeRecurrence(todo);
      todo.status = TodoStatus.IN_PROGRESS;
      todo.version += 1;
      return repo.save(todo);
    });
    await this.emitUpdated(saved);
    return saved;
  }

  // COMPLETED on a recurring todo spawns the next occurrence. Runs in a
  // transaction with a row lock; a second concurrent completion re-reads
  // "already completed" and no-ops, preventing a duplicate occurrence (§9.2 #2).
  private async completeTodo(
    todoId: string,
    userId: string,
    dto: UpdateTodoDto,
    ifMatchVersion: number,
  ): Promise<Todo> {
    const result = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(Todo);
      const todo = await m
        .createQueryBuilder(Todo, 't')
        .setLock('pessimistic_write')
        .where('t.id = :id', { id: todoId })
        .getOne();
      if (!todo) throw new NotFoundException('Todo not found');
      await this.lists.assertCanEdit(todo.listId, userId);
      if (todo.status === TodoStatus.COMPLETED) {
        return { saved: todo, next: null as Todo | null };
      }
      if (ifMatchVersion !== todo.version) throw new ConflictException('Version mismatch');
      this.applyPatch(todo, dto);
      this.normalizeRecurrence(todo);
      todo.status = TodoStatus.COMPLETED;
      todo.completedAt = new Date();
      todo.version += 1;
      const saved = await repo.save(todo);

      let next: Todo | null = null;
      if (saved.recurrenceUnit && saved.recurrenceInterval && saved.dueDate) {
        next = await repo.save(
          repo.create({
            listId: saved.listId,
            name: saved.name,
            description: saved.description,
            dueDate: nextDueDate(saved.dueDate, saved.recurrenceUnit, saved.recurrenceInterval),
            priority: saved.priority,
            recurrenceUnit: saved.recurrenceUnit,
            recurrenceInterval: saved.recurrenceInterval,
            createdById: userId,
          }),
        );
      }
      return { saved, next };
    });
    await this.emitUpdated(result.saved);
    if (result.next) this.emitter.emitTodoCreated(result.next.listId, withBlocked(result.next, false));
    return result.saved;
  }

  async softDelete(todoId: string, userId: string): Promise<void> {
    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) {
      throw new NotFoundException('Todo not found');
    }
    // Capture dependents BEFORE deleting so we can refresh their blocked state.
    const dependents = await dependentIdsOf(this.dataSource.manager, todo.id);
    await this.lists.assertCanEdit(todo.listId, userId);
    await this.todos.softDelete(todo.id);
    this.emitter.emitTodoDeleted(todo.listId, todo.id);
    await this.emitTodosById(dependents);
  }

  // Emit a todo:updated carrying a fresh `blocked` flag, then refresh the
  // blocked state of every todo that depends on it (its status change may have
  // flipped their blocked state). Keeps dependency badges live without a refetch.
  private async emitUpdated(todo: Todo): Promise<void> {
    const blocked = await isBlocked(this.dataSource.manager, todo.id);
    this.emitter.emitTodoUpdated(todo.listId, withBlocked(todo, blocked));
    const dependents = await dependentIdsOf(this.dataSource.manager, todo.id);
    await this.emitTodosById(dependents);
  }

  private async emitTodosById(ids: string[]): Promise<void> {
    for (const id of ids) {
      const dep = await this.todos.findOne({ where: { id } });
      if (!dep) continue;
      const blocked = await isBlocked(this.dataSource.manager, dep.id);
      this.emitter.emitTodoUpdated(dep.listId, withBlocked(dep, blocked));
    }
  }

  // Applies non-status scalar fields from the DTO (status handled by callers).
  private applyPatch(todo: Todo, dto: UpdateTodoDto): void {
    if (dto.name !== undefined) todo.name = dto.name;
    if (dto.description !== undefined) todo.description = dto.description;
    if (dto.priority !== undefined) todo.priority = dto.priority;
    if (dto.dueDate !== undefined) todo.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.recurrenceUnit !== undefined) todo.recurrenceUnit = dto.recurrenceUnit;
    if (dto.recurrenceInterval !== undefined) todo.recurrenceInterval = dto.recurrenceInterval;
  }

  // Keep recurrence fields consistent: recurring needs a due date + interval≥1;
  // non-recurring clears the interval.
  private normalizeRecurrence(todo: Todo): void {
    if (todo.recurrenceUnit) {
      if (!todo.dueDate) {
        throw new BadRequestException('Recurring todos require a due date');
      }
      if (!todo.recurrenceInterval) todo.recurrenceInterval = 1;
    } else {
      todo.recurrenceInterval = null;
    }
  }
}
