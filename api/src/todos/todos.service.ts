import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListsService } from '../lists/lists.service';
import { REALTIME_EMITTER, RealtimeEmitter } from '../realtime/realtime.types';
import { CreateTodoDto } from './dto/create-todo.dto';
import { ListTodosQueryDto } from './dto/list-todos-query.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo, TodoPriority } from './todo.entity';
import {
  SORT_CONFIG,
  decodeCursor,
  encodeCursor,
  keysetClause,
} from './todo-keyset';

export interface PaginatedTodos {
  items: Todo[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
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

    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        const { sql, params } = keysetClause(config, dir, cursor);
        qb.andWhere(sql, params);
      }
    }

    const orderDir = dir === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(config.expr, orderDir, 'NULLS LAST')
      .addOrderBy('t.id', orderDir)
      .take(limit + 1);

    const rows = await qb.getMany();
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
    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) {
      throw new NotFoundException('Todo not found');
    }
    await this.lists.assertCanEdit(todo.listId, userId);
    if (ifMatchVersion !== todo.version) {
      throw new ConflictException('Version mismatch');
    }
    if (dto.name !== undefined) todo.name = dto.name;
    if (dto.description !== undefined) todo.description = dto.description;
    if (dto.status !== undefined) todo.status = dto.status;
    if (dto.priority !== undefined) todo.priority = dto.priority;
    if (dto.dueDate !== undefined) todo.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
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
}
