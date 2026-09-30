import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatsService } from '../chats/chats.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const MAX_PARTICIPANTS = 10;
const userSelect = { id: true, name: true, avatarUrl: true } as const;

type CallRow = { id: string; chatId: string; type: string; initiatorId: string };
const pub = (c: CallRow) => ({ id: c.id, chatId: c.chatId, type: c.type, initiatorId: c.initiatorId });

@Injectable()
export class CallsService {
  private readonly rooms: RoomServiceClient;
  private readonly key: string;
  private readonly secret: string;
  private readonly wsUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private chats: ChatsService,
    private gateway: RealtimeGateway,
  ) {
    this.key = config.getOrThrow('LIVEKIT_API_KEY');
    this.secret = config.getOrThrow('LIVEKIT_API_SECRET');
    this.wsUrl = config.getOrThrow('LIVEKIT_URL');
    this.rooms = new RoomServiceClient(config.getOrThrow('LIVEKIT_HTTP_URL'), this.key, this.secret);
  }

  private async mintToken(userId: string, name: string, room: string) {
    const at = new AccessToken(this.key, this.secret, { identity: userId, name: name || 'User', ttl: '2h' });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
    return await at.toJwt();
  }

  private async notifyMembers(chatId: string, event: string, payload: unknown, exceptUserId?: string) {
    const members = await this.prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
    members
      .filter((m) => m.userId !== exceptUserId)
      .forEach((m) => this.gateway.emitToUser(m.userId, event, payload));
  }

  private async getCall(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: { chat: { select: { type: true, name: true } } },
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  private async finish(call: { id: string; chatId: string; roomName: string }) {
    const now = new Date();
    await this.prisma.call.update({ where: { id: call.id }, data: { status: 'ENDED', endedAt: now } });
    await this.prisma.callParticipant.updateMany({ where: { callId: call.id, leftAt: null }, data: { leftAt: now } });
    try {
      await this.rooms.deleteRoom(call.roomName);
    } catch {
      /* room may already be gone */
    }
    await this.notifyMembers(call.chatId, 'call:ended', { callId: call.id });
  }

  async start(me: string, chatId: string, type: 'VOICE' | 'VIDEO') {
    await this.chats.assertMember(chatId, me);

    // ring timeout: unanswered calls older than 60s no longer block new calls
    await this.prisma.call.updateMany({
      where: { chatId, status: 'RINGING', createdAt: { lt: new Date(Date.now() - 60_000) } },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    const active = await this.prisma.call.findFirst({ where: { chatId, status: { in: ['RINGING', 'ACTIVE'] } } });
    if (active) throw new ConflictException('A call is already in progress in this chat');

    const id = randomUUID();
    const roomName = `call_${id}`;
    try {
      await this.rooms.createRoom({ name: roomName, maxParticipants: MAX_PARTICIPANTS, emptyTimeout: 300 });
    } catch {
      throw new ServiceUnavailableException('Call server (LiveKit) is not reachable. Is Docker running?');
    }

    const call = await this.prisma.call.create({
      data: { id, chatId, initiatorId: me, type, roomName, participants: { create: { userId: me } } },
    });
    const user = await this.prisma.user.findUnique({ where: { id: me } });
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId }, select: { type: true, name: true } });

    await this.notifyMembers(
      chatId,
      'call:incoming',
      { call: pub(call), fromName: user?.name || 'Someone', chatTitle: chat?.type === 'GROUP' ? chat.name : null },
      me,
    );
    return { call: pub(call), token: await this.mintToken(me, user?.name ?? '', roomName), url: this.wsUrl };
  }

  async join(me: string, callId: string) {
    const call = await this.getCall(callId);
    await this.chats.assertMember(call.chatId, me);
    if (call.status === 'ENDED') throw new BadRequestException('This call has ended');

    const others = await this.prisma.callParticipant.count({
      where: { callId, leftAt: null, userId: { not: me } },
    });
    if (others >= MAX_PARTICIPANTS) throw new ConflictException('Call is full (max 10 participants)');

    await this.prisma.callParticipant.upsert({
      where: { callId_userId: { callId, userId: me } },
      update: { leftAt: null, joinedAt: new Date() },
      create: { callId, userId: me },
    });
    if (call.status === 'RINGING' && me !== call.initiatorId) {
      await this.prisma.call.update({ where: { id: callId }, data: { status: 'ACTIVE', startedAt: new Date() } });
    }
    const user = await this.prisma.user.findUnique({ where: { id: me } });
    return { call: pub(call), token: await this.mintToken(me, user?.name ?? '', call.roomName), url: this.wsUrl };
  }

  async decline(me: string, callId: string) {
    const call = await this.getCall(callId);
    await this.chats.assertMember(call.chatId, me);
    if (call.status !== 'ENDED' && call.chat.type === 'DIRECT') await this.finish(call);
    return { ok: true };
  }

  async leave(me: string, callId: string) {
    const call = await this.getCall(callId);
    await this.prisma.callParticipant.updateMany({
      where: { callId, userId: me, leftAt: null },
      data: { leftAt: new Date() },
    });
    const remaining = await this.prisma.callParticipant.count({ where: { callId, leftAt: null } });
    if (call.status !== 'ENDED' && (remaining === 0 || call.chat.type === 'DIRECT')) await this.finish(call);
    return { ok: true };
  }

  async end(me: string, callId: string) {
    const call = await this.getCall(callId);
    const member = await this.chats.assertMember(call.chatId, me);
    if (call.initiatorId !== me && member.role !== 'ADMIN') throw new ForbiddenException('Only the host can end the call');
    if (call.status !== 'ENDED') await this.finish(call);
    return { ok: true };
  }

  async history(me: string) {
    const rows = await this.prisma.call.findMany({
      where: { chat: { members: { some: { userId: me } } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        initiator: { select: userSelect },
        participants: true,
        chat: { select: { type: true, name: true } },
      },
    });
    return rows.map((c) => {
      const outgoing = c.initiatorId === me;
      const joined = c.participants.some((p) => p.userId === me);
      const seconds = c.startedAt && c.endedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : 0;
      return {
        id: c.id,
        chatId: c.chatId,
        type: c.type,
        status: c.status,
        direction: outgoing ? 'outgoing' : joined ? 'incoming' : 'missed',
        initiator: c.initiator,
        createdAt: c.createdAt,
        durationSeconds: seconds,
      };
    });
  }
}
