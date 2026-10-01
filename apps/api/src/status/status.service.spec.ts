import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { StatusService } from './status.service.js';

const UUID_URL = '/media/123e4567-e89b-12d3-a456-426614174000.png';

function setup() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    status: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    statusView: { createMany: vi.fn(), findMany: vi.fn() },
    chatMember: { findMany: vi.fn() },
  };
  return { svc: new StatusService(prisma as never), prisma };
}

const contacts = (prisma: ReturnType<typeof setup>['prisma'], ids: string[]) => {
  prisma.chatMember.findMany.mockResolvedValueOnce([{ chatId: 'c1' }]).mockResolvedValueOnce(ids.map((userId) => ({ userId })));
};

describe('StatusService.create', () => {
  it('rejects an empty status', async () => {
    const { svc } = setup();
    await expect(svc.create('u1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a media URL that is not one of our uploads', async () => {
    const { svc } = setup();
    await expect(svc.create('u1', { mediaUrl: 'https://evil.example/x.png' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('expires a new status after 24 hours', async () => {
    const { svc, prisma } = setup();
    prisma.status.create.mockResolvedValue({ id: 's1' });
    await svc.create('u1', { body: 'hello', mediaUrl: UUID_URL, mediaType: 'IMAGE' });
    const data = prisma.status.create.mock.calls[0][0].data;
    const diff = data.expiresAt.getTime() - Date.now();
    expect(Math.abs(diff - 24 * 3600_000)).toBeLessThan(5000);
    expect(data.mediaUrl).toBe(UUID_URL);
  });
});

describe('StatusService.view', () => {
  it('404 for an expired status', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u2', expiresAt: new Date(Date.now() - 1000) });
    await expect(svc.view('u1', 's1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not count the owner viewing their own status', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 60000) });
    await svc.view('u1', 's1');
    expect(prisma.statusView.createMany).not.toHaveBeenCalled();
  });

  it('forbids viewers who share no chat with the owner', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u2', expiresAt: new Date(Date.now() + 60000) });
    contacts(prisma, ['u3']);
    await expect(svc.view('u1', 's1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records a view idempotently for a contact', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u2', expiresAt: new Date(Date.now() + 60000) });
    contacts(prisma, ['u2']);
    await svc.view('u1', 's1');
    expect(prisma.statusView.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});

describe('StatusService owner-only actions', () => {
  it('only the owner can delete', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u2' });
    await expect(svc.remove('u1', 's1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only the owner can list viewers', async () => {
    const { svc, prisma } = setup();
    prisma.status.findUnique.mockResolvedValue({ id: 's1', userId: 'u2' });
    await expect(svc.viewers('u1', 's1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StatusService.feed', () => {
  it('separates my statuses and flags unviewed contacts', async () => {
    const { svc, prisma } = setup();
    contacts(prisma, ['u2']);
    const base = { body: 'x', bgColor: null, mediaUrl: null, mediaType: null, createdAt: new Date() };
    prisma.status.findMany.mockResolvedValue([
      { ...base, id: 's1', userId: 'u1', user: { id: 'u1', name: 'Me', avatarUrl: null }, views: [], _count: { views: 2 } },
      { ...base, id: 's2', userId: 'u2', user: { id: 'u2', name: 'Bob', avatarUrl: null }, views: [], _count: { views: 0 } },
    ]);
    const feed = await svc.feed('u1');
    expect(feed.mine?.statuses[0].viewCount).toBe(2);
    expect(feed.others).toHaveLength(1);
    expect(feed.others[0].allViewed).toBe(false);
  });
});
