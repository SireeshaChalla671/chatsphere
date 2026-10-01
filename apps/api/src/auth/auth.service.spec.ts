import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function setup(env: Record<string, string> = {}) {
  const prisma = {
    otpCode: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    refreshToken: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('access.jwt') };
  const config = { get: vi.fn((k: string) => env[k]), getOrThrow: vi.fn(() => 'secret') };
  const svc = new AuthService(prisma as never, jwt as never, config as never);
  return { svc, prisma, jwt };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('AuthService.sendOtp', () => {
  it('rate-limits a second request within 30 seconds', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue({ createdAt: new Date() });
    const err = await svc.sendOtp('a@b.com').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(prisma.otpCode.create).not.toHaveBeenCalled();
  });

  it('stores only a hash of a 6-digit code and returns it in dev mode', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const res = await svc.sendOtp('a@b.com');
    expect(res.devOtp).toMatch(/^\d{6}$/);
    const stored = prisma.otpCode.create.mock.calls[0][0].data;
    expect(stored.codeHash).not.toBe(res.devOtp);
    expect(await bcrypt.compare(res.devOtp as string, stored.codeHash)).toBe(true);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('normalizes email identifiers', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    await svc.sendOtp('  A@B.COM ');
    expect(prisma.otpCode.create.mock.calls[0][0].data.identifier).toBe('a@b.com');
  });

  it('never returns the code in production', async () => {
    const { svc, prisma } = setup({ NODE_ENV: 'production' });
    prisma.otpCode.findFirst.mockResolvedValue(null);
    const res = await svc.sendOtp('a@b.com');
    expect(res).not.toHaveProperty('devOtp');
  });
});

describe('AuthService.verifyOtp', () => {
  it('rejects when no code was requested', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue(null);
    await expect(svc.verifyOtp('a@b.com', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired code', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'o1', expiresAt: new Date(Date.now() - 1000), attempts: 0, codeHash: 'x' });
    await expect(svc.verifyOtp('a@b.com', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks after 5 failed attempts', async () => {
    const { svc, prisma } = setup();
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'o1', expiresAt: new Date(Date.now() + 60000), attempts: 5, codeHash: 'x' });
    await expect(svc.verifyOtp('a@b.com', '123456')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts a wrong attempt', async () => {
    const { svc, prisma } = setup();
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'o1', expiresAt: new Date(Date.now() + 60000), attempts: 0, codeHash });
    await expect(svc.verifyOtp('a@b.com', '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.otpCode.update.mock.calls[0][0].data).toEqual({ attempts: { increment: 1 } });
  });

  it('creates a user, issues tokens, stores only the refresh token hash and burns the code', async () => {
    const { svc, prisma } = setup();
    const codeHash = await bcrypt.hash('123456', 4);
    prisma.otpCode.findFirst.mockResolvedValue({ id: 'o1', expiresAt: new Date(Date.now() + 60000), attempts: 0, codeHash });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
    const res = await svc.verifyOtp('a@b.com', '123456');
    expect(res.isNewUser).toBe(true);
    expect(res.accessToken).toBe('access.jwt');
    expect(res.refreshToken).toHaveLength(96);
    const row = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(row.tokenHash).toBe(sha256(res.refreshToken));
    expect(row.tokenHash).not.toBe(res.refreshToken);
    expect(prisma.otpCode.deleteMany).toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rejects an unknown refresh token', async () => {
    const { svc, prisma } = setup();
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await expect(svc.refresh('nope')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates: looks up by hash, revokes the old token, issues a new pair', async () => {
    const { svc, prisma } = setup();
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'r1', userId: 'u1' });
    const res = await svc.refresh('tok');
    expect(prisma.refreshToken.findFirst.mock.calls[0][0].where.tokenHash).toBe(sha256('tok'));
    expect(prisma.refreshToken.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
    expect(res.accessToken).toBe('access.jwt');
    expect(res.refreshToken).not.toBe('tok');
  });
});
