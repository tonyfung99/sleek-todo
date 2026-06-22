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
import { UpdateTodoDto } from './dto/update-todo.dto';
import { Todo } from './todo.entity';

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    private readonly lists: ListsService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  async listForList(listId: string, userId: string): Promise<Todo[]> {
    await this.lists.assertMember(listId, userId);
    return this.todos.find({ where: { listId } });
  }

  async create(listId: string, userId: string, dto: CreateTodoDto): Promise<Todo> {
    await this.lists.assertCanEdit(listId, userId);
    const todo = await this.todos.save(
      this.todos.create({
        listId,
        name: dto.name,
        description: dto.description ?? null,
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
