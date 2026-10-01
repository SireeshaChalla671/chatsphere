import { beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:3000';
const run = Date.now();

async function req(path: string, method = 'GET', body?: unknown, token?: string) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email: string) {
  const o = await req('/auth/send-otp', 'POST', { identifier: email });
  const v = await req('/auth/verify-otp', 'POST', { identifier: email, code: o.data.devOtp });
  if (v.status >= 300) throw new Error('login failed: ' + JSON.stringify(v.data));
  return v.data as { accessToken: string; refreshToken: string; user: { id: string } };
}

let a: Awaited<ReturnType<typeof login>>;
let b: Awaited<ReturnType<typeof login>>;
let c: Awaited<ReturnType<typeof login>>;
let chatId = '';

beforeAll(async () => {
  a = await login(`flow${run}a@example.com`);
  b = await login(`flow${run}b@example.com`);
  c = await login(`flow${run}c@example.com`);
  const chat = await req('/chats/direct', 'POST', { userId: b.user.id }, a.accessToken);
  chatId = chat.data.id;
});

describe('auth', () => {
  it('protected routes need a token', async () => {
    expect((await req('/auth/me')).status).toBe(401);
  });

  it('a wrong code is rejected', async () => {
    const email = `flow${run}w@example.com`;
    const o = await req('/auth/send-otp', 'POST', { identifier: email });
    const wrong = o.data.devOtp === '000000' ? '111111' : '000000';
    expect((await req('/auth/verify-otp', 'POST', { identifier: email, code: wrong })).status).toBe(400);
  });

  it('refresh tokens rotate and cannot be reused', async () => {
    const u = await login(`flow${run}r@example.com`);
    const first = await req('/auth/refresh', 'POST', { refreshToken: u.refreshToken });
    expect(first.status).toBe(201);
    const second = await req('/auth/refresh', 'POST', { refreshToken: u.refreshToken });
    expect(second.status).toBe(401);
  });
});

describe('chats', () => {
  it('rejects an empty message body', async () => {
    expect((await req(`/chats/${chatId}/messages`, 'POST', { body: '' }, a.accessToken)).status).toBe(400);
  });

  it('delivers a message and counts it as unread for the recipient', async () => {
    const sent = await req(`/chats/${chatId}/messages`, 'POST', { body: 'hello b' }, a.accessToken);
    expect(sent.status).toBe(201);
    const list = await req('/chats', 'GET', undefined, b.accessToken);
    const mine = list.data.find((x: { id: string }) => x.id === chatId);
    expect(mine.unreadCount).toBeGreaterThanOrEqual(1);
    expect(mine.lastMessage.body).toBe('hello b');
  });

  it('a repeated clientId does not create a duplicate', async () => {
    const m1 = await req(`/chats/${chatId}/messages`, 'POST', { body: 'once', clientId: 'dup-' + run }, a.accessToken);
    const m2 = await req(`/chats/${chatId}/messages`, 'POST', { body: 'once', clientId: 'dup-' + run }, a.accessToken);
    expect(m2.data.id).toBe(m1.data.id);
  });

  it('an outsider can neither read nor write', async () => {
    expect((await req(`/chats/${chatId}/messages`, 'GET', undefined, c.accessToken)).status).toBe(403);
    expect((await req(`/chats/${chatId}/messages`, 'POST', { body: 'hi' }, c.accessToken)).status).toBe(403);
  });
});

describe('calls', () => {
  it('runs a call lifecycle with permission checks', async () => {
    const start = await req('/calls', 'POST', { chatId, type: 'VOICE' }, a.accessToken);
    expect(start.status).toBe(201);
    expect(start.data.token).toBeTruthy();
    const callId = start.data.call.id;

    expect((await req('/calls', 'POST', { chatId, type: 'VOICE' }, a.accessToken)).status).toBe(409);
    expect((await req(`/calls/${callId}/join`, 'POST', undefined, c.accessToken)).status).toBe(403);
    expect((await req(`/calls/${callId}/join`, 'POST', undefined, b.accessToken)).status).toBe(201);
    expect((await req(`/calls/${callId}/end`, 'POST', undefined, b.accessToken)).status).toBe(403);
    expect((await req(`/calls/${callId}/end`, 'POST', undefined, a.accessToken)).status).toBe(201);
  });
});
