import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = 'http://localhost:3000';
const WEB = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, method = 'GET', body, token) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email) {
  for (let i = 0; i < 3; i++) {
    const o = await call('/auth/send-otp', 'POST', { identifier: email });
    if (o.status === 429) {
      console.log('  rate limited for ' + email + ', waiting 31s...');
      await sleep(31000);
      continue;
    }
    const v = await call('/auth/verify-otp', 'POST', { identifier: email, code: o.data.devOtp });
    if (v.status >= 300) throw new Error('login failed for ' + email + ': ' + JSON.stringify(v.data));
    return v.data;
  }
  throw new Error('could not log in ' + email);
}

async function setup(n) {
  const users = [];
  for (let i = 1; i <= n; i++) {
    const u = await login('load' + i + '@example.com');
    await call('/users/me', 'PATCH', { name: 'Load ' + i }, u.accessToken);
    users.push(u);
    process.stdout.write('.');
  }
  console.log(' ' + n + ' users ready');
  const ids = users.slice(1).map((_, i) => 'load' + (i + 2) + '@example.com');
  const g = await call('/chats/group', 'POST', { name: 'Load test ' + new Date().toLocaleTimeString(), identifiers: ids }, users[0].accessToken);
  if (g.status >= 300) throw new Error('group failed: ' + JSON.stringify(g.data));
  return { users, chatId: g.data.id };
}

async function cap() {
  const { users, chatId } = await setup(11);
  const start = await call('/calls', 'POST', { chatId, type: 'VOICE' }, users[0].accessToken);
  if (start.status >= 300) throw new Error('start failed: ' + JSON.stringify(start.data));
  const callId = start.data.call.id;
  console.log('Participant  1 (host): started the call');
  let pass = true;
  for (let i = 1; i < 11; i++) {
    const r = await call('/calls/' + callId + '/join', 'POST', undefined, users[i].accessToken);
    const shouldJoin = i < 10;
    const good = shouldJoin ? r.status < 300 : r.status === 409;
    if (!good) pass = false;
    console.log(
      'Participant ' + String(i + 1).padStart(2) + ': HTTP ' + r.status + (shouldJoin ? ' (expected join)' : ' (expected rejection: ' + (r.data.message ?? '') + ')') + (good ? '  OK' : '  FAIL'),
    );
  }
  await call('/calls/' + callId + '/end', 'POST', undefined, users[0].accessToken);
  console.log(pass ? '\nPASS: 10 participants allowed, the 11th was rejected.' : '\nFAIL: see lines above.');
}

function findBrowser() {
  const pf = process.env.ProgramFiles, pf86 = process.env['ProgramFiles(x86)'], la = process.env.LOCALAPPDATA;
  return [
    pf + '\\Google\\Chrome\\Application\\chrome.exe',
    pf86 + '\\Google\\Chrome\\Application\\chrome.exe',
    la + '\\Google\\Chrome\\Application\\chrome.exe',
    pf86 + '\\Microsoft\\Edge\\Application\\msedge.exe',
    pf + '\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => existsSync(p));
}

async function launch(n) {
  const exe = findBrowser();
  if (!exe) throw new Error('Chrome or Edge not found');
  const { users } = await setup(n);
  const root = join(tmpdir(), 'chatsphere-load');
  users.forEach((u, i) => {
    const dir = join(root, 'u' + (i + 1));
    mkdirSync(dir, { recursive: true });
    const payload = Buffer.from(JSON.stringify({ a: u.accessToken, r: u.refreshToken, auto: i > 0 })).toString('base64');
    const col = i % 5, row = Math.floor(i / 5);
    spawn(exe, [
      '--user-data-dir=' + dir,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--window-size=420,340',
      '--window-position=' + col * 270 + ',' + row * 330,
      WEB + '/#dev=' + payload,
    ], { detached: true, stdio: 'ignore' }).unref();
    console.log('Opened window for Load ' + (i + 1) + (i === 0 ? ' (host, click here)' : ' (auto-accepts calls)'));
  });
  console.log('\nWait about 10 seconds, then in the "Load 1" window open the "Load test" group and click Video.');
}

const [mode, n] = process.argv.slice(2);
if (mode === 'cap') await cap();
else if (mode === 'launch') await launch(Math.min(Math.max(Number(n) || 6, 2), 10));
else console.log('Usage: node loadtest.mjs cap   |   node loadtest.mjs launch <2-10>');
