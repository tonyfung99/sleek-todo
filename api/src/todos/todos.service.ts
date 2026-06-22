import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ListsService } from '../lists/lists.service';
import { runSerializable } from '../common/serializable';
import { REALTIME_EMITTER, RealtimeEmitter } from '../realtime/realtime.types';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosQueryDto } from './dto/list-todos-query.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo, TodoPriority, TodoStatus } from './todo.entity';
import { TodoDependency } from './todo-dependency.entity';
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
    const todo = await this.todos.save(
      this.todos.create({
        listId,
        name: dto.name,
        description: dto.description ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        priority: dto.priority ?? TodoPriority.MEDIUM,
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
    // Transitioning to IN_PROGRESS is dependency-gated and write-skew-prone, so it
    // runs under SERIALIZABLE + retry (design spec §9.2 #3). Other edits use the
    // optimistic version check only.
    if (dto.status === TodoStatus.IN_PROGRESS) {
      const saved = await runSerializable(this.dataSource, async (m) => {
        const repo = m.getRepository(Todo);
        const todo = await repo.findOne({ where: { id: todoId } });
        if (!todo) throw new NotFoundException('Todo not found');
        await this.lists.assertCanEdit(todo.listId, userId);
        if (ifMatchVersion !== todo.version) throw new ConflictException('Version mismatch');
        if (await this.hasUnmetDependencies(m, todoId)) {
          throw new UnprocessableEntityException(
            'Blocked: every dependency must be COMPLETED before starting',
          );
        }
        this.applyPatch(todo, dto);
        todo.status = TodoStatus.IN_PROGRESS;
        todo.version += 1;
        return repo.save(todo);
      });
      this.emitter.emitTodoUpdated(saved.listId, saved);
      return saved;
    }

    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) throw new NotFoundException('Todo not found');
    await this.lists.assertCanEdit(todo.listId, userId);
    if (ifMatchVersion !== todo.version) throw new ConflictException('Version mismatch');
    this.applyPatch(todo, dto);
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

  // Applies non-status scalar fields from the DTO (status handled by callers).
  private applyPatch(todo: Todo, dto: UpdateTodoDto): void {
    if (dto.name !== undefined) todo.name = dto.name;
    if (dto.description !== undefined) todo.description = dto.description;
    if (dto.priority !== undefined) todo.priority = dto.priority;
    if (dto.dueDate !== undefined) todo.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
  }

  private async hasUnmetDependencies(m: EntityManager, todoId: string): Promise<boolean> {
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
}
