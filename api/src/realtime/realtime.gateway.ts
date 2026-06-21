import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  ConnectedSocket,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.types';
import { ListsService } from '../lists/lists.service';
import { MemberRole } from '../lists/list-membership.entity';
import { Todo } from '../todos/todo.entity';
import { LockService } from './lock.service';
import { PresenceService } from './presence.service';
import { LockHolder, PresenceViewer, RealtimeEmitter } from './realtime.types';

interface SocketUser {
  userId: string;
  displayName: string;
  color: string;
}

const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

function colorFor(userId: string): string {
  let hash = 0;
  for (const ch of userId) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, RealtimeEmitter
{
  @WebSocketServer()
  server!: Server;

  // socketId -> { listId, userId } so disconnect can clean presence up (single-instance).
  private readonly socketPresence = new Map<string, { listId: string; userId: string }[]>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly lists: ListsService,
    private readonly locks: LockService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit(): void {
    const url = this.config.getOrThrow<string>('REDIS_URL');
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();
    this.server.adapter(createAdapter(pubClient, subClient));
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: SocketUser = {
        userId: payload.sub,
        displayName: payload.displayName,
        color: colorFor(payload.sub),
      };
      client.data.user = user;
    } catch (_err) {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const released = await this.locks.releaseAllForSocket(client.id);
    for (const { listId, todoId } of released) {
      this.server.to(`list:${listId}`).emit('lock:released', { todoId });
    }
    const entries = this.socketPresence.get(client.id) ?? [];
    for (const { listId, userId } of entries) {
      await this.presence.leave(listId, userId);
      await this.broadcastPresence(listId);
    }
    this.socketPresence.delete(client.id);
  }

  @SubscribeMessage('list:join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    await this.lists.assertMember(body.listId, user.userId);
    await client.join(`list:${body.listId}`);
    await this.presence.join(body.listId, {
      userId: user.userId,
      displayName: user.displayName,
      color: user.color,
    });
    const entries = this.socketPresence.get(client.id) ?? [];
    entries.push({ listId: body.listId, userId: user.userId });
    this.socketPresence.set(client.id, entries);
    await this.broadcastPresence(body.listId);
  }

  @SubscribeMessage('list:leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    await client.leave(`list:${body.listId}`);
    await this.presence.leave(body.listId, user.userId);
    const entries = (this.socketPresence.get(client.id) ?? []).filter(
      (e) => e.listId !== body.listId,
    );
    this.socketPresence.set(client.id, entries);
    await this.broadcastPresence(body.listId);
  }

  @SubscribeMessage('editing:start')
  async onEditingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string; todoId: string },
  ): Promise<void> {
    const user = client.data.user as SocketUser;
    const membership = await this.lists.assertMember(body.listId, user.userId);
    if (membership.role === MemberRole.VIEWER) {
      client.emit('lock:denied', { todoId: body.todoId, heldBy: null });
      return;
    }
    const holder: LockHolder = {
      userId: user.userId,
      displayName: user.displayName,
      socketId: client.id,
    };
    const acquired = await this.locks.acquire(body.listId, body.todoId, holder);
    if (acquired) {
      this.server.to(`list:${body.listId}`).emit('lock:granted', {
        todoId: body.todoId,
        userId: user.userId,
        displayName: user.displayName,
      });
    } else {
      const current = await this.locks.getHolder(body.listId, body.todoId);
      client.emit('lock:denied', { todoId: body.todoId, heldBy: current });
    }
  }

  @SubscribeMessage('editing:stop')
  async onEditingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listId: string; todoId: string },
  ): Promise<void> {
    const released = await this.locks.release(body.listId, body.todoId, client.id);
    if (released) {
      this.server.to(`list:${body.listId}`).emit('lock:released', { todoId: body.todoId });
    }
  }

  private async broadcastPresence(listId: string): Promise<void> {
    const viewers: PresenceViewer[] = await this.presence.list(listId);
    this.server.to(`list:${listId}`).emit('presence:update', { viewers });
  }

  emitTodoCreated(listId: string, todo: Todo): void {
    this.server.to(`list:${listId}`).emit('todo:created', { todo });
  }

  emitTodoUpdated(listId: string, todo: Todo): void {
    this.server.to(`list:${listId}`).emit('todo:updated', { todo });
  }

  emitTodoDeleted(listId: string, todoId: string): void {
    this.server.to(`list:${listId}`).emit('todo:deleted', { todoId });
  }
}
