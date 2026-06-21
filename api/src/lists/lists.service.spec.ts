import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ListsService } from './lists.service';
import { TodoList } from './todo-list.entity';
import { ListMembership, MemberRole } from './list-membership.entity';
import { User } from '../users/user.entity';

function buildService() {
  const lists: TodoList[] = [];
  const memberships: ListMembership[] = [];
  const users: User[] = [
    { id: 'owner', email: 'owner@x.com', passwordHash: 'h', displayName: 'Owner' } as User,
    { id: 'other', email: 'other@x.com', passwordHash: 'h', displayName: 'Other' } as User,
  ];

  const listRepo = {
    create: (d: Partial<TodoList>) => ({ id: 'list-1', ...d }) as TodoList,
    find: async ({ where }: { where: { id: string } }) =>
      lists.filter((l) => l.id === where.id),
  } as unknown as Repository<TodoList>;

  const memberRepo = {
    create: (d: Partial<ListMembership>) => ({ id: `m-${memberships.length}`, ...d }) as ListMembership,
    findOne: async ({ where }: { where: { listId: string; userId: string } }) =>
      memberships.find((m) => m.listId === where.listId && m.userId === where.userId) ?? null,
    find: async ({ where }: { where: { userId: string } }) =>
      memberships.filter((m) => m.userId === where.userId),
    save: async (m: ListMembership) => {
      memberships.push(m);
      return m;
    },
  } as unknown as Repository<ListMembership>;

  const userRepo = {
    findOne: async ({ where }: { where: { email: string } }) =>
      users.find((u) => u.email === where.email) ?? null,
  } as unknown as Repository<User>;

  const manager = {
    save: async <T>(_entity: unknown, e: T) => {
      const obj = e as unknown as TodoList | ListMembership;
      if ('ownerId' in obj) lists.push(obj as TodoList);
      else memberships.push(obj as ListMembership);
      return e;
    },
  } as unknown as EntityManager;

  const dataSource = {
    transaction: async <T>(cb: (m: EntityManager) => Promise<T>) => cb(manager),
  } as unknown as DataSource;

  const service = new ListsService(listRepo, memberRepo, userRepo, dataSource);
  return { service, lists, memberships, users };
}

describe('ListsService', () => {
  it('create makes the list and an OWNER membership', async () => {
    const { service, lists, memberships } = buildService();
    const list = await service.create('owner', 'Groceries');
    expect(list.name).toBe('Groceries');
    expect(lists).toHaveLength(1);
    const ownerMembership = memberships.find((m) => m.userId === 'owner');
    expect(ownerMembership?.role).toBe(MemberRole.OWNER);
  });

  it('assertMember throws 403 for a non-member', async () => {
    const { service } = buildService();
    await expect(service.assertMember('list-1', 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('addMember by a non-owner is rejected with 403', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await expect(
      service.addMember('list-1', 'other', 'other@x.com', MemberRole.EDITOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('addMember by the owner adds the user', async () => {
    const { service, memberships } = buildService();
    await service.create('owner', 'Groceries');
    const m = await service.addMember('list-1', 'owner', 'other@x.com', MemberRole.EDITOR);
    expect(m.userId).toBe('other');
    expect(m.role).toBe(MemberRole.EDITOR);
    expect(memberships).toHaveLength(2);
  });

  it('addMember rejects an unknown email with 404', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await expect(
      service.addMember('list-1', 'owner', 'ghost@x.com', MemberRole.EDITOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assertCanEdit rejects a VIEWER with 403', async () => {
    const { service } = buildService();
    await service.create('owner', 'Groceries');
    await service.addMember('list-1', 'owner', 'other@x.com', MemberRole.VIEWER);
    await expect(service.assertCanEdit('list-1', 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
