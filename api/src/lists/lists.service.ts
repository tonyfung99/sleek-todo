import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { ListMembership, MemberRole } from './list-membership.entity';
import { TodoList } from './todo-list.entity';

@Injectable()
export class ListsService {
  constructor(
    @InjectRepository(TodoList) private readonly lists: Repository<TodoList>,
    @InjectRepository(ListMembership) private readonly memberships: Repository<ListMembership>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(userId: string, name: string): Promise<TodoList> {
    return this.dataSource.transaction(async (manager) => {
      const list = await manager.save(
        TodoList,
        this.lists.create({ name, ownerId: userId }),
      );
      await manager.save(
        ListMembership,
        this.memberships.create({
          listId: list.id,
          userId,
          role: MemberRole.OWNER,
        }),
      );
      return list;
    });
  }

  async findForUser(userId: string): Promise<TodoList[]> {
    const memberships = await this.memberships.find({ where: { userId } });
    const listIds = memberships.map((m) => m.listId);
    if (listIds.length === 0) {
      return [];
    }
    const result: TodoList[] = [];
    for (const id of listIds) {
      const found = await this.lists.find({ where: { id } });
      result.push(...found);
    }
    return result;
  }

  async assertMember(listId: string, userId: string): Promise<ListMembership> {
    const membership = await this.memberships.findOne({ where: { listId, userId } });
    if (!membership) {
      throw new ForbiddenException('Not a member of this list');
    }
    return membership;
  }

  async assertCanEdit(listId: string, userId: string): Promise<ListMembership> {
    const membership = await this.assertMember(listId, userId);
    if (membership.role === MemberRole.VIEWER) {
      throw new ForbiddenException('Insufficient role');
    }
    return membership;
  }

  async addMember(
    listId: string,
    requesterId: string,
    email: string,
    role: MemberRole,
  ): Promise<ListMembership> {
    const requester = await this.assertMember(listId, requesterId);
    if (requester.role !== MemberRole.OWNER) {
      throw new ForbiddenException('Only the owner can add members');
    }
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const existing = await this.memberships.findOne({
      where: { listId, userId: user.id },
    });
    if (existing) {
      return existing;
    }
    return this.memberships.save(
      this.memberships.create({ listId, userId: user.id, role }),
    );
  }
}
