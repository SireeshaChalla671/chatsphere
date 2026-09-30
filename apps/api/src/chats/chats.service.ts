import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const userSelect = { id: true, name: true, avatarUrl: true, about: true } as const;

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  async assertMember(chatId: string, userId: string) {
    const m = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!m) throw new ForbiddenException('Not a member of this chat');
    return m;
  }

  async getOrCreateDirect(me: string, otherId: string) {
    if (me === otherId) throw new BadRequestException('Cannot chat with yourself');
    const other = await this.prisma.user.findUnique({ where: { id: otherId } });
    if (!other) throw new NotFoundException('User not found');

    const directKey = [me, otherId].sort().join(':');
    const include = { members: { include: { user: { select: userSelect } } } };

    const existing = await this.prisma.chat.findUnique({ where: { directKey }, include });
    if (existing) return existing;

    return this.prisma.chat.create({
      data: {
        type: 'DIRECT',
        directKey,
        createdById: me,
        members: { create: [{ userId: me }, { userId: otherId }] },
      },
      include,
    });
  }

  async listChats(me: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId: me, archived: false },
      include: {
        chat: {
          include: {
            members: { include: { user: { select: userSelect } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });

    const result = await Promise.all(
      memberships.map(async (m) => {
        const unreadCount = await this.prisma.message.count({
          where: {
            chatId: m.chatId,
            senderId: { not: me },
            deletedForAll: false,
            ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
          },
        });
        const { messages, ...chat } = m.chat;
        return { ...chat, lastMessage: messages[0] ?? null, unreadCount, pinned: m.pinned, muted: m.muted };
      }),
    );

    return result.sort(
      (a, b) =>
        (b.lastMessageAt ?? b.createdAt).getTime() - (a.lastMessageAt ?? a.createdAt).getTime(),
    );
  }

  async getMessages(me: string, chatId: string, cursor?: string, limit = 30) {
    await this.assertMember(chatId, me);
    const take = Math.min(Math.max(limit, 1), 100);

    const items = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { sender: { select: userSelect } },
    });

    const hasMore = items.length > take;
    const page = (hasMore ? items.slice(0, take) : items).map((m) =>
      m.deletedForAll ? { ...m, body: null } : m,
    );
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async sendMessage(me: string, chatId: string, body: string, clientId?: string, replyToId?: string) {
    await this.assertMember(chatId, me);

    if (clientId) {
      const dup = await this.prisma.message.findUnique({
        where: { senderId_clientId: { senderId: me, clientId } },
        include: { sender: { select: userSelect } },
      });
      if (dup) return dup;
    }

    const others = await this.prisma.chatMember.findMany({
      where: { chatId, userId: { not: me } },
      select: { userId: true },
    });

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          chatId,
          senderId: me,
          body,
          clientId,
          replyToId,
          receipts: { create: others.map((o) => ({ userId: o.userId })) },
        },
        include: { sender: { select: userSelect } },
      }),
      this.prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: new Date() } }),
    ]);
    return message;
  }
}
