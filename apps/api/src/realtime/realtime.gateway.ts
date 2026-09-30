import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatsService } from '../chats/chats.service.js';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private online = new Map<string, Set<string>>(); // userId -> socket ids

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private chats: ChatsService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? '';
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      const userId = payload.sub as string;
      client.data.userId = userId;

      client.join(`user:${userId}`);
      const memberships = await this.prisma.chatMember.findMany({
        where: { userId },
        select: { chatId: true },
      });
      memberships.forEach((m) => client.join(`chat:${m.chatId}`));

      const set = this.online.get(userId) ?? new Set();
      set.add(client.id);
      this.online.set(userId, set);
      if (set.size === 1) this.server.emit('presence', { userId, online: true });

      // messages sent while offline are now "delivered"
      await this.markDeliveredForUser(userId);
    } catch {
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const set = this.online.get(userId);
    set?.delete(client.id);
    if (!set || set.size === 0) {
      this.online.delete(userId);
      const lastSeenAt = new Date();
      await this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt } });
      this.server.emit('presence', { userId, online: false, lastSeenAt });
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
    @MessageBody() data: { chatId: string; body: string; clientId?: string; replyToId?: string },
  ) {
    const me = client.data.userId as string;
    if (!me || !data?.body?.trim()) return { ok: false, error: 'invalid' };
    try {
      const message = await this.chats.sendMessage(me, data.chatId, data.body, data.clientId, data.replyToId);
      this.server.in(`chat:${data.chatId}`).socketsJoin(`chat:${data.chatId}`); // no-op safety
      this.server.to(`chat:${data.chatId}`).emit('message:new', message);

      // mark delivered for recipients who are online right now
      const receipts = await this.prisma.messageReceipt.findMany({
        where: { messageId: message.id, deliveredAt: null },
      });
      const now = new Date();
      for (const r of receipts) {
        if (this.online.has(r.userId)) {
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

  @SubscribeMessage('chat:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() data: { chatId: string }) {
    const me = client.data.userId as string;
    await this.chats.assertMember(data.chatId, me);
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