import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CallsService } from './calls.service.js';

function setup() {
  const prisma = {
    call: { findUnique: vi.fn(), update: vi.fn() },
    callParticipant: { count: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  const chats = { assertMember: vi.fn().mockResolvedValue({ role: 'MEMBER' }) };
  const cfg: Record<string, string> = {
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret_at_least_32_characters_long_123',
    LIVEKIT_URL: 'ws://localhost:7880',
    LIVEKIT_HTTP_URL: 'http://localhost:7880',
  };
  const config = { getOrThrow: vi.fn((k: string) => cfg[k]) };
  const gateway = { emitToUser: vi.fn() };
  const svc = new CallsService(prisma as never, config as never, chats as never, gateway as never);
  return { svc, prisma, chats };
}

const call = {
  id: 'call1', chatId: 'c1', type: 'VIDEO', initiatorId: 'host', status: 'ACTIVE',
  roomName: 'call_call1', chat: { type: 'GROUP', name: 'G' },
};

describe('CallsService.join', () => {
  it('rejects the 11th participant', async () => {
    const { svc, prisma } = setup();
    prisma.call.findUnique.mockResolvedValue(call);
    prisma.callParticipant.count.mockResolvedValue(10);
    await expect(svc.join('u11', 'call1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.callParticipant.upsert).not.toHaveBeenCalled();
  });

  it('lets the 10th participant in and returns a LiveKit token', async () => {
    const { svc, prisma } = setup();
    prisma.call.findUnique.mockResolvedValue(call);
    prisma.callParticipant.count.mockResolvedValue(9);
    prisma.callParticipant.upsert.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ name: 'Bob' });
    const res = await svc.join('u10', 'call1');
    expect(res.token.split('.')).toHaveLength(3);
    expect(res.url).toBe('ws://localhost:7880');
  });

  it('refuses to join an ended call', async () => {
    const { svc, prisma } = setup();
    prisma.call.findUnique.mockResolvedValue({ ...call, status: 'ENDED' });
    await expect(svc.join('u2', 'call1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checks chat membership before issuing a token', async () => {
    const { svc, prisma, chats } = setup();
    prisma.call.findUnique.mockResolvedValue(call);
    chats.assertMember.mockRejectedValue(new ForbiddenException('Not a member of this chat'));
    await expect(svc.join('outsider', 'call1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.callParticipant.count).not.toHaveBeenCalled();
  });
});

describe('CallsService.end', () => {
  it('only the host or a group admin can end the call for everyone', async () => {
    const { svc, prisma } = setup();
    prisma.call.findUnique.mockResolvedValue(call);
    await expect(svc.end('someone-else', 'call1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
