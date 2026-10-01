import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatsService } from './chats.service.js';

function setup() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    chatMember: { findUnique: vi.fn(), findMany: vi.fn() },
    chat: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    message: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    reaction: { findUnique: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  };
  return { svc: new ChatsService(prisma as never), prisma };
}

describe('ChatsService.getOrCreateDirect', () => {
  it('refuses a chat with yourself', async () => {
    const { svc } = setup();
    await expect(svc.getOrCreateDirect('u1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails for an unknown user', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(svc.getOrCreateDirect('u1', 'u2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses the same directKey regardless of who starts the chat', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'x' });
    prisma.chat.findUnique.mockResolvedValue(null);
    prisma.chat.create.mockResolvedValue({ id: 'c1' });
    await svc.getOrCreateDirect('b', 'a');
    await svc.getOrCreateDirect('a', 'b');
    const keys = prisma.chat.create.mock.calls.map((c: [{ data: { directKey: string } }]) => c[0].data.directKey);
    expect(keys).toEqual(['a:b', 'a:b']);
  });

  it('returns the existing chat instead of creating a duplicate', async () => {
    const { svc, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.chat.findUnique.mockResolvedValue({ id: 'existing' });
    const chat = await svc.getOrCreateDirect('u1', 'u2');
    expect(chat.id).toBe('existing');
    expect(prisma.chat.create).not.toHaveBeenCalled();
  });
});

describe('ChatsService.sendMessage', () => {
  it('rejects a non-member', async () => {
    const { svc, prisma } = setup();
    prisma.chatMember.findUnique.mockResolvedValue(null);
    await expect(svc.sendMessage('u1', 'c1', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('is idempotent: a repeated clientId returns the stored message', async () => {
    const { svc, prisma } = setup();
    prisma.chatMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.message.findUnique.mockResolvedValue({ id: 'dup' });
    const m = await svc.sendMessage('u1', 'c1', 'hi', 'client-1');
    expect(m.id).toBe('dup');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates one receipt per other member', async () => {
    const { svc, prisma } = setup();
    prisma.chatMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.chat.update.mockResolvedValue({});
    const m = await svc.sendMessage('u1', 'c1', 'hi');
    expect(m.id).toBe('m1');
    expect(prisma.message.create.mock.calls[0][0].data.receipts.create).toEqual([{ userId: 'u2' }, { userId: 'u3' }]);
  });

  it('drops a reply that points at a message from another chat', async () => {
    const { svc, prisma } = setup();
    prisma.chatMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.message.findUnique.mockResolvedValue({ chatId: 'other-chat' });
    prisma.chatMember.findMany.mockResolvedValue([]);
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    prisma.chat.update.mockResolvedValue({});
    await svc.sendMessage('u1', 'c1', 'hi', undefined, 'foreign');
    expect(prisma.message.create.mock.calls[0][0].data.replyToId).toBeUndefined();
  });
});

describe('ChatsService.editMessage', () => {
  const fresh = { id: 'm1', senderId: 'u1', chatId: 'c1', type: 'TEXT', deletedForAll: false, createdAt: new Date() };

  it('404 for an unknown message', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(null);
    await expect(svc.editMessage('u1', 'm1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only the author can edit', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(fresh);
    await expect(svc.editMessage('u2', 'm1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses edits after 15 minutes', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue({ ...fresh, createdAt: new Date(Date.now() - 16 * 60_000) });
    await expect(svc.editMessage('u1', 'm1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to edit media messages', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue({ ...fresh, type: 'IMAGE' });
    await expect(svc.editMessage('u1', 'm1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves the trimmed text and marks it edited', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(fresh);
    prisma.message.update.mockResolvedValue({});
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'm1', body: 'new' });
    await svc.editMessage('u1', 'm1', '  new  ');
    const data = prisma.message.update.mock.calls[0][0].data;
    expect(data.body).toBe('new');
    expect(data.editedAt).toBeInstanceOf(Date);
  });
});

describe('ChatsService.deleteForAll', () => {
  it('only the author can delete', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue({ id: 'm1', senderId: 'u1' });
    await expect(svc.deleteForAll('u2', 'm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('wipes the body and media', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue({ id: 'm1', senderId: 'u1' });
    prisma.message.update.mockResolvedValue({});
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'm1' });
    await svc.deleteForAll('u1', 'm1');
    const data = prisma.message.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ deletedForAll: true, body: null, mediaUrl: null });
  });
});

describe('ChatsService.toggleReaction', () => {
  const msg = { id: 'm1', chatId: 'c1' };

  it('rejects a non-member', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.chatMember.findUnique.mockResolvedValue(null);
    await expect(svc.toggleReaction('u9', 'm1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removes a reaction when the same emoji is sent again', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.chatMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.reaction.findUnique.mockResolvedValue({ id: 'r1', emoji: 'A' });
    prisma.message.findUniqueOrThrow.mockResolvedValue(msg);
    await svc.toggleReaction('u1', 'm1', 'A');
    expect(prisma.reaction.delete).toHaveBeenCalled();
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
  });

  it('switches to a different emoji', async () => {
    const { svc, prisma } = setup();
    prisma.message.findUnique.mockResolvedValue(msg);
    prisma.chatMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    prisma.reaction.findUnique.mockResolvedValue({ id: 'r1', emoji: 'A' });
    prisma.message.findUniqueOrThrow.mockResolvedValue(msg);
    await svc.toggleReaction('u1', 'm1', 'B');
    expect(prisma.reaction.upsert).toHaveBeenCalled();
    expect(prisma.reaction.delete).not.toHaveBeenCalled();
  });
});
