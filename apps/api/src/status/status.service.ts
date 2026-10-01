import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY = 24 * 3600_000;
const MEDIA_URL = /^\/media\/[a-f0-9-]{36}(\.[a-z0-9]{1,10})?$/i;
const userSel = { id: true, name: true, avatarUrl: true } as const;

type StatusItem = {
  id: string; body: string | null; bgColor: string | null; mediaUrl: string | null;
  mediaType: string | null; createdAt: Date; viewed: boolean; viewCount: number;
};
type Group = { user: { id: string; name: string; avatarUrl: string | null }; statuses: StatusItem[]; allViewed: boolean };

@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), 3600_000);
    this.timer.unref();
    void this.cleanup();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private cleanup() {
    return this.prisma.status.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  }

  // contacts = everyone who shares at least one chat with me
  private async contactIds(me: string) {
    const mine = await this.prisma.chatMember.findMany({ where: { userId: me }, select: { chatId: true } });
    const others = await this.prisma.chatMember.findMany({
      where: { chatId: { in: mine.map((m) => m.chatId) }, userId: { not: me } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return others.map((o) => o.userId);
  }

  async create(me: string, input: { body?: string; bgColor?: string; mediaUrl?: string; mediaType?: string }) {
    const body = input.body?.trim() || null;
    const hasMedia = !!input.mediaUrl;
    if (!body && !hasMedia) throw new BadRequestException('Status is empty');
    if (hasMedia && !MEDIA_URL.test(input.mediaUrl as string)) throw new BadRequestException('Invalid media');
    return this.prisma.status.create({
      data: {
        userId: me,
        body,
        bgColor: input.bgColor ?? null,
        mediaUrl: hasMedia ? (input.mediaUrl as string) : null,
        mediaType: hasMedia ? (input.mediaType ?? 'IMAGE') : null,
        expiresAt: new Date(Date.now() + DAY),
      },
    });
  }

  async feed(me: string) {
    const ids = await this.contactIds(me);
    const rows = await this.prisma.status.findMany({
      where: { expiresAt: { gt: new Date() }, userId: { in: [me, ...ids] } },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: userSel },
        views: { where: { viewerId: me }, select: { id: true } },
        _count: { select: { views: true } },
      },
    });

    const map = new Map<string, Group>();
    for (const r of rows) {
      const g = map.get(r.userId) ?? { user: r.user, statuses: [], allViewed: true };
      const viewed = r.userId === me || r.views.length > 0;
      g.statuses.push({
        id: r.id, body: r.body, bgColor: r.bgColor, mediaUrl: r.mediaUrl, mediaType: r.mediaType,
        createdAt: r.createdAt, viewed, viewCount: r._count.views,
      });
      if (!viewed) g.allViewed = false;
      map.set(r.userId, g);
    }

    const mine = map.get(me) ?? null;
    map.delete(me);
    const others = [...map.values()].sort((a, b) => {
      if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
      const la = a.statuses[a.statuses.length - 1].createdAt.getTime();
      const lb = b.statuses[b.statuses.length - 1].createdAt.getTime();
      return lb - la;
    });
    return { mine, others };
  }

  async view(me: string, id: string) {
    const s = await this.prisma.status.findUnique({ where: { id } });
    if (!s || s.expiresAt < new Date()) throw new NotFoundException('Status not found');
    if (s.userId === me) return { ok: true };
    const ids = await this.contactIds(me);
    if (!ids.includes(s.userId)) throw new ForbiddenException('Not allowed');
    await this.prisma.statusView.createMany({
    data: [{ statusId: id, viewerId: me }],
    skipDuplicates: true,
    });
    return { ok: true };
  }

  async viewers(me: string, id: string) {
    const s = await this.prisma.status.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Status not found');
    if (s.userId !== me) throw new ForbiddenException('Only the owner can see viewers');
    const rows = await this.prisma.statusView.findMany({
      where: { statusId: id },
      orderBy: { viewedAt: 'desc' },
      include: { viewer: { select: userSel } },
    });
    return rows.map((r) => ({ id: r.viewer.id, name: r.viewer.name, viewedAt: r.viewedAt }));
  }

  async remove(me: string, id: string) {
    const s = await this.prisma.status.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Status not found');
    if (s.userId !== me) throw new ForbiddenException('You can only delete your own status');
    await this.prisma.status.delete({ where: { id } });
    return { ok: true };
  }
}
