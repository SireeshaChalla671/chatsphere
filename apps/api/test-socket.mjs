import { io } from 'socket.io-client';

const API = 'http://localhost:3000';
const post = (path, body, token) =>
  fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function login(id) {
  const o = await post('/auth/send-otp', { identifier: id });
  return post('/auth/verify-otp', { identifier: id, code: o.devOtp });
}

const a = await login('test@example.com');
const b = await login('friend@example.com');
const chat = await post('/chats/direct', { userId: b.user.id }, a.accessToken);

const sa = io(API, { auth: { token: a.accessToken } });
const sb = io(API, { auth: { token: b.accessToken } });

sb.on('message:new', (m) => console.log('B received:', m.body));
sb.on('typing', (t) => console.log('B sees typing:', t.typing));
sa.on('message:delivered', () => console.log('A sees delivered'));
sa.on('message:read', () => console.log('A sees read'));
sa.on('presence', (p) => console.log('presence:', p));

await new Promise((r) => setTimeout(r, 1000));
sa.emit('typing', { chatId: chat.id, typing: true });
await new Promise((r) => setTimeout(r, 300));
const ack = await sa.emitWithAck('message:send', { chatId: chat.id, body: 'Realtime hello!' });
console.log('send ack:', ack.ok);
await new Promise((r) => setTimeout(r, 500));
sb.emit('message:read', { chatId: chat.id });
await new Promise((r) => setTimeout(r, 800));
process.exit(0);
