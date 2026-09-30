import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const userSelect = { id: true, name: true, avatarUrl: true, about: true } as const;
const messageInclude = {
  sender: { select: userSelect },
  receipts: true,
  reactions: true,
  replyTo: {
    select: { id: true, body: true, type: true, deletedForAll: true, sender: { select: { id: true, name: true } } },
  },
} as const;
const MEDIA_URL = /^\/media\/[a-f0-9-]{36}(\.[a-z0-9]{1,10})?$/i;
export type MediaInput = {
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT';
  url: string;
  mime?: string;
  name?: string;
  size?: number;
};

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

  private async resolveUsers(identifiers: string[]) {
    const norm = identifiers
      .map((i) => i.trim())
      .filter(Boolean)
      .map((v) => (v.includes('@') ? v.toLowerCase() : v.replace(/\s+/g, '')));
    const users = await this.prisma.user.findMany({
      where: { OR: [{ email: { in: norm } }, { phone: { in: norm } }] },
    });
    const found = new Set<string>();
    users.forEach((u) => {
      if (u.email) found.add(u.email);
      if (u.phone) found.add(u.phone);
    });
    const missing = norm.filter((n) => !found.has(n));
    if (missing.length) throw new NotFoundException('No account found for: ' + missing.join(', '));
    return users;
  }

  private async assertAdmin(chatId: string, userId: string) {
    const m = await this.assertMember(chatId, userId);
    if (m.role !== 'ADMIN') throw new ForbiddenException('Only group admins can do this');
    return m;
  }

  async createGroup(me: string, name: string, identifiers: string[]) {
    const users = await this.resolveUsers(identifiers);
    const ids = [...new Set(users.map((u) => u.id).filter((id) => id !== me))];
    if (ids.length < 1) throw new BadRequestException('Add at least one other member');
    return this.prisma.chat.create({
      data: {
        type: 'GROUP',
        name: name.trim(),
        createdById: me,
        members: { create: [{ userId: me, role: 'ADMIN' }, ...ids.map((userId) => ({ userId }))] },
      },
      include: { members: { include: { user: { select: userSelect } } } },
    });
  }

  async addMembers(me: string, chatId: string, identifiers: string[]) {
    await this.assertAdmin(chatId, me);
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } });
    if (chat?.type !== 'GROUP') throw new BadRequestException('Not a group chat');
    const users = await this.resolveUsers(identifiers);
    const count = await this.prisma.chatMember.count({ where: { chatId } });
    if (count + users.length > 256) throw new BadRequestException('Groups are limited to 256 members');
    await this.prisma.chatMember.createMany({
      data: users.map((u) => ({ chatId, userId: u.id })),
      skipDuplicates: true,
    });
    return { ok: true };
  }

  async removeMember(me: string, chatId: string, userId: string) {
    await this.assertAdmin(chatId, me);
    if (userId === me) throw new BadRequestException('Use leave instead');
    await this.prisma.chatMember.deleteMany({ where: { chatId, userId } });
    return { ok: true };
  }

  async leaveGroup(me: string, chatId: string) {
    await this.assertMember(chatId, me);
    await this.prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId: me } } });
    const rest = await this.prisma.chatMember.findMany({ where: { chatId }, orderBy: { joinedAt: 'asc' } });
    if (rest.length === 0) {
      await this.prisma.chat.delete({ where: { id: chatId } });
    } else if (!rest.some((m) => m.role === 'ADMIN')) {
      await this.prisma.chatMember.update({ where: { id: rest[0].id }, data: { role: 'ADMIN' } });
    }
    return { ok: true };
  }

  private getMessageFull(id: string) {
    return this.prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
  }

  async editMessage(me: string, messageId: string, body: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundException('Message not found');
    if (m.senderId !== me) throw new ForbiddenException('You can only edit your own messages');
    if (m.deletedForAll) throw new BadRequestException('Message was deleted');
    if (m.type !== 'TEXT') throw new BadRequestException('Only text messages can be edited');
    if (Date.now() - m.createdAt.getTime() > 15 * 60_000) throw new BadRequestException('Messages can only be edited within 15 minutes');
    const text = body.trim();
    if (!text || text.length > 4000) throw new BadRequestException('Invalid message');
    await this.prisma.message.update({ where: { id: messageId }, data: { body: text, editedAt: new Date() } });
    return this.getMessageFull(messageId);
  }

  async deleteForAll(me: string, messageId: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundException('Message not found');
    if (m.senderId !== me) throw new ForbiddenException('You can only delete your own messages');
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedForAll: true, body: null, mediaUrl: null, mediaName: null, mediaMime: null, mediaSize: null },
    });
    return this.getMessageFull(messageId);
  }

  async toggleReaction(me: string, messageId: string, emoji: string) {
    const m = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundException('Message not found');
    await this.assertMember(m.chatId, me);
    if (!emoji || emoji.length > 8) throw new BadRequestException('Invalid emoji');
    const existing = await this.prisma.reaction.findUnique({ where: { messageId_userId: { messageId, userId: me } } });
    if (existing && existing.emoji === emoji) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.reaction.upsert({
        where: { messageId_userId: { messageId, userId: me } },
        update: { emoji },
        create: { messageId, userId: me, emoji },
      });
    }
    return this.getMessageFull(messageId);
  }

  async searchMessages(me: string, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    return this.prisma.message.findMany({
      where: {
        deletedForAll: false,
        body: { contains: term, mode: 'insensitive' },
        chat: { members: { some: { userId: me } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sender: { select: userSelect }, chat: { select: { id: true, type: true, name: true } } },
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
      include: messageInclude,
    });

    const hasMore = items.length > take;
    const page = (hasMore ? items.slice(0, take) : items).map((m) =>
      m.deletedForAll ? { ...m, body: null } : m,
    );
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async sendMessage(me: string, chatId: string, body: string, clientId?: string, replyToId?: string, media?: MediaInput) {
    await this.assertMember(chatId, me);

    if (clientId) {
      const dup = await this.prisma.message.findUnique({
        where: { senderId_clientId: { senderId: me, clientId } },
        include: messageInclude,
      });
      if (dup) return dup;
    }

    if (replyToId) {
      const ref = await this.prisma.message.findUnique({ where: { id: replyToId }, select: { chatId: true } });
      if (ref?.chatId !== chatId) replyToId = undefined;
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
          body: body || null,
          ...(media && MEDIA_URL.test(media.url)
            ? {
                type: media.type,
                mediaUrl: media.url,
                mediaMime: media.mime,
                mediaName: media.name,
                mediaSize: Number.isInteger(media.size) ? media.size : null,
              }
            : {}),
          clientId,
          replyToId,
          receipts: { create: others.map((o) => ({ userId: o.userId })) },
        },
        include: messageInclude,
      }),
      this.prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: new Date() } }),
    ]);
    return message;
  }
}
