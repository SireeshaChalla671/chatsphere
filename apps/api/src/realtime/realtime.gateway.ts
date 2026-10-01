import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatsService } from '../chats/chats.service.js';
import { PushService } from '../push/push.service.js';

type MediaIn = { type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'; url: string; mime?: string; name?: string; size?: number };
const pkey = (userId: string) => `presence:${userId}`;

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private redis: Redis;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private chats: ChatsService,
    private push: PushService,
  ) {
    this.redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
    this.redis.on('error', () => undefined);
  }

  async onModuleInit() {
    // Single-instance safety: a crash can leave stale presence keys, so clear them on boot.
    try {
      const keys = await this.redis.keys('presence:*');
      if (keys.length) await this.redis.del(...keys);
    } catch {
      /* redis unavailable */
    }
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  private async chatIdsOf(userId: string) {
    const rows = await this.prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } });
    return rows.map((r) => r.chatId);
  }

  private async isOnline(userId: string) {
    try {
      return (await this.redis.scard(pkey(userId))) > 0;
    } catch {
      return false;
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? '';
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });
      const userId = payload.sub as string;
      client.data.userId = userId;

      client.join(`user:${userId}`);
      const chatIds = await this.chatIdsOf(userId);
      chatIds.forEach((id) => client.join(`chat:${id}`));

      await this.redis.sadd(pkey(userId), client.id);
      await this.redis.expire(pkey(userId), 86400);
      const count = await this.redis.scard(pkey(userId));
      if (count === 1 && chatIds.length) {
        this.server.to(chatIds.map((id) => `chat:${id}`)).emit('presence', { userId, online: true });
      }

      // tell this client who among its contacts is already online
      if (chatIds.length) {
        const others = await this.prisma.chatMember.findMany({
          where: { chatId: { in: chatIds }, userId: { not: userId } },
          select: { userId: true },
          distinct: ['userId'],
        });
        const flags = await Promise.all(others.map((o) => this.redis.scard(pkey(o.userId))));
        client.emit('presence:snapshot', { online: others.filter((_, i) => flags[i] > 0).map((o) => o.userId) });
      }

      await this.markDeliveredForUser(userId);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    try {
      await this.redis.srem(pkey(userId), client.id);
      if ((await this.redis.scard(pkey(userId))) === 0) {
        const lastSeenAt = new Date();
        await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt } }).catch(() => undefined);
        const chatIds = await this.chatIdsOf(userId);
        if (chatIds.length) {
          this.server.to(chatIds.map((id) => `chat:${id}`)).emit('presence', { userId, online: false, lastSeenAt });
        }
      }
    } catch {
      /* never let a disconnect crash the server */
    }
  }

  private async markDeliveredForUser(userId: string) {
    const pending = await this.prisma.messageReceipt.findMany({
      where: { userId, deliveredAt: null },
      include: { message: { select: { id: true, chatId: true, senderId: true } } },
    });
    if (!pending.length) return;
    const now = new Date();
    await this.prisma.messageReceipt.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: { deliveredAt: now },
    });
    for (const p of pending) {
      this.server.to(`user:${p.message.senderId}`).emit('message:delivered', {
        messageId: p.message.id,
        chatId: p.message.chatId,
        userId,
        at: now,
      });
    }
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: string; body?: string; clientId?: string; replyToId?: string; media?: MediaIn },
  ) {
    const me = client.data.userId as string;
    if (!me || (!data?.body?.trim() && !data?.media?.url)) return { ok: false, error: 'invalid' };
    try {
      const message = await this.chats.sendMessage(me, data.chatId, data.body ?? '', data.clientId, data.replyToId, data.media);
      const members = await this.prisma.chatMember.findMany({ where: { chatId: data.chatId }, select: { userId: true } });
      members.forEach((m) => this.server.in(`user:${m.userId}`).socketsJoin(`chat:${data.chatId}`));
      this.server.to(`chat:${data.chatId}`).emit('message:new', message);
      void this.pushToOffline(me, data.chatId, message);

      const receipts = await this.prisma.messageReceipt.findMany({ where: { messageId: message.id, deliveredAt: null } });
      const now = new Date();
      for (const r of receipts) {
        if (await this.isOnline(r.userId)) {
          await this.prisma.messageReceipt.update({ where: { id: r.id }, data: { deliveredAt: now } });
          this.server.to(`user:${me}`).emit('message:delivered', {
            messageId: message.id,
            chatId: data.chatId,
            userId: r.userId,
            at: now,
          });
        }
      }
      return { ok: true, message };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

    private async pushToOffline(
    me: string,
    chatId: string,
    message: { body?: string | null; type?: string; sender?: { name: string } | null },
  ) {
    try {
      const members = await this.prisma.chatMember.findMany({
        where: { chatId, userId: { not: me }, muted: false },
        select: { userId: true },
      });
      const label: Record<string, string> = { IMAGE: 'Photo', VIDEO: 'Video', AUDIO: 'Voice message', DOCUMENT: 'Document' };
      const body = message.body || label[message.type ?? ''] || 'New message';
      for (const m of members) {
        if (!(await this.isOnline(m.userId))) {
          await this.push.notify(m.userId, { title: message.sender?.name || 'New message', body, url: '/', tag: 'chat:' + chatId });
        }
      }
    } catch {
      /* push must never break message delivery */
    }
  }

  @SubscribeMessage('message:edit')
  async onEdit(@ConnectedSocket() client: Socket, @MessageBody() data: { messageId: string; body: string }) {
    try {
      const m = await this.chats.editMessage(client.data.userId as string, data.messageId, data.body ?? '');
      this.server.to(`chat:${m.chatId}`).emit('message:updated', m);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('message:delete')
  async onDelete(@ConnectedSocket() client: Socket, @MessageBody() data: { messageId: string }) {
    try {
      const m = await this.chats.deleteForAll(client.data.userId as string, data.messageId);
      this.server.to(`chat:${m.chatId}`).emit('message:updated', m);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('message:react')
  async onReact(@ConnectedSocket() client: Socket, @MessageBody() data: { messageId: string; emoji: string }) {
    try {
      const m = await this.chats.toggleReaction(client.data.userId as string, data.messageId, data.emoji);
      this.server.to(`chat:${m.chatId}`).emit('message:updated', m);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('chat:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { chatId: string }) {
    await this.chats.assertMember(data.chatId, client.data.userId as string);
    client.join(`chat:${data.chatId}`);
    return { ok: true };
  }

  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() client: Socket, @MessageBody() data: { chatId: string; typing: boolean }) {
    const me = client.data.userId as string;
    if (!me || !client.rooms.has(`chat:${data.chatId}`)) return;
    client.to(`chat:${data.chatId}`).emit('typing', { chatId: data.chatId, userId: me, typing: !!data.typing });
  }

  @SubscribeMessage('message:read')
  async onRead(@ConnectedSocket() client: Socket, @MessageBody() data: { chatId: string }) {
    const me = client.data.userId as string;
    await this.chats.assertMember(data.chatId, me);
    const now = new Date();
    await this.prisma.chatMember.update({
      where: { chatId_userId: { chatId: data.chatId, userId: me } },
      data: { lastReadAt: now },
    });
    await this.prisma.messageReceipt.updateMany({
      where: { userId: me, readAt: null, message: { chatId: data.chatId } },
      data: { readAt: now, deliveredAt: now },
    });
    client.to(`chat:${data.chatId}`).emit('message:read', { chatId: data.chatId, userId: me, at: now });
    return { ok: true };
  }
}
