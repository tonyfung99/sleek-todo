import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ListsService } from '../lists/lists.service';
import { runSerializable } from '../common/serializable';
import { REALTIME_EMITTER, RealtimeEmitter } from '../realtime/realtime.types';
import { wouldCreateCycle } from './dependency-graph';
import { isBlocked, withBlocked } from './todo-blocked';
import { Todo, TodoStatus } from './todo.entity';
import { TodoDependency } from './todo-dependency.entity';

@Injectable()
export class DependenciesService {
  constructor(
    @InjectRepository(Todo) private readonly todos: Repository<Todo>,
    @InjectRepository(TodoDependency) private readonly deps: Repository<TodoDependency>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly lists: ListsService,
    @Inject(REALTIME_EMITTER) private readonly emitter: RealtimeEmitter,
  ) {}

  async list(todoId: string, userId: string): Promise<Todo[]> {
    const todo = await this.todos.findOne({ where: { id: todoId } });
    if (!todo) throw new NotFoundException('Todo not found');
    await this.lists.assertMember(todo.listId, userId);
    const edges = await this.deps.find({ where: { dependentId: todoId } });
    if (edges.length === 0) return [];
    return this.todos.find({ where: { id: In(edges.map((e) => e.dependencyId)) } });
  }

  async add(
    dependentId: string,
    dependencyId: string,
    userId: string,
  ): Promise<TodoDependency> {
    if (dependentId === dependencyId) {
      throw new BadRequestException('A todo cannot depend on itself');
    }
    const [dependent, dependency] = await Promise.all([
      this.todos.findOne({ where: { id: dependentId } }),
      this.todos.findOne({ where: { id: dependencyId } }),
    ]);
    if (!dependent || !dependency) throw new NotFoundException('Todo not found');
    if (dependent.listId !== dependency.listId) {
      throw new BadRequestException('Dependencies must be within the same list');
    }
    await this.lists.assertCanEdit(dependent.listId, userId);

    // Cycle check + insert under SERIALIZABLE so two concurrent adds (A→B, B→A)
    // cannot jointly create a cycle (design spec §9.2 write-skew #4).
    const edge = await runSerializable(this.dataSource, async (m) => {
      const depRepo = m.getRepository(TodoDependency);
      const listTodos = await m
        .getRepository(Todo)
        .find({ where: { listId: dependent.listId } });
      const ids = new Set(listTodos.map((t) => t.id));
      const allEdges = await depRepo.find();
      const edges = allEdges.filter((e) => ids.has(e.dependentId) && ids.has(e.dependencyId));
      if (wouldCreateCycle(edges, dependentId, dependencyId)) {
        throw new ConflictException('Adding this dependency would create a cycle');
      }
      const existing = await depRepo.findOne({ where: { dependentId, dependencyId } });
      if (existing) return existing;
      return depRepo.save(depRepo.create({ dependentId, dependencyId }));
    });

    // Adding an edge can change the dependent's blocked state → emit it fresh.
    const fresh = await this.todos.findOne({ where: { id: dependentId } });
    if (fresh) {
      const blocked = await isBlocked(this.dataSource.manager, fresh.id);
      this.emitter.emitTodoUpdated(dependent.listId, withBlocked(fresh, blocked));
    }
    return edge;
  }

  async remove(dependentId: string, dependencyId: string, userId: string): Promise<void> {
    const dependent = await this.todos.findOne({ where: { id: dependentId } });
    if (!dependent) throw new NotFoundException('Todo not found');
    await this.lists.assertCanEdit(dependent.listId, userId);
    await this.deps.delete({ dependentId, dependencyId });
    // Removing an edge can unblock the dependent → emit it fresh.
    const blocked = await isBlocked(this.dataSource.manager, dependent.id);
    this.emitter.emitTodoUpdated(dependent.listId, withBlocked(dependent, blocked));
  }

  /** Dependencies of `todoId` that are not yet COMPLETED (used by the status gate). */
  async unmetDependencies(todoId: string): Promise<Todo[]> {
    const edges = await this.deps.find({ where: { dependentId: todoId } });
    if (edges.length === 0) return [];
    const deps = await this.todos.find({ where: { id: In(edges.map((e) => e.dependencyId)) } });
    return deps.filter((d) => d.status !== TodoStatus.COMPLETED);
  }
}
