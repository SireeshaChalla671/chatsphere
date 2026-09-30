'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API, api, getTokens } from '@/lib/api';
import type { Chat, Message, User } from '@/lib/types';

const TICK = '\u2713';
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = (s: string) => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const sortChats = (l: Chat[]) =>
  [...l].sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime());

function titleOf(c: Chat, meId: string) {
  if (c.type === 'GROUP') return c.name ?? 'Group';
  const o = c.members.find((m) => m.userId !== meId)?.user;
  return o?.name || 'User ' + (o?.id ?? '').slice(0, 4);
}
function statusOf(m: Message, meId: string) {
  const r = (m.receipts ?? []).filter((x) => x.userId !== meId);
  if (r.length && r.every((x) => x.readAt)) return 'read';
  if (r.length && r.every((x) => x.deliveredAt)) return 'delivered';
  return 'sent';
}

export default function ChatApp({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<User | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searched, setSearched] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const activeRef = useRef<string | null>(null);
  const meRef = useRef<User | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const askedRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const loadChats = useCallback(async () => {
    setChats(sortChats(await api<Chat[]>('/chats')));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let s: Socket | undefined;
    (async () => {
      let u = await api<User>('/auth/me');
      if (!u.name && !askedRef.current) {
        askedRef.current = true;
        const n = window.prompt('Welcome! What is your name?');
        if (n && n.trim()) u = await api<User>('/users/me', { method: 'PATCH', body: { name: n.trim() } });
      }
      if (cancelled) return;
      setMe(u); meRef.current = u;
      await loadChats();
      if (cancelled) return;

      s = io(API, { auth: (cb) => cb({ token: getTokens()?.accessToken }) });
      socketRef.current = s;

      s.on('message:new', (m: Message) => {
        const meId = meRef.current!.id;
        setMessages((p) => {
          const l = p[m.chatId];
          if (!l || l.some((x) => x.id === m.id)) return p;
          return { ...p, [m.chatId]: [...l, m] };
        });
        const mine = m.senderId === meId;
        const isActive = activeRef.current === m.chatId;
        if (!chatsRef.current.some((c) => c.id === m.chatId)) { loadChats(); return; }
        setChats((p) => sortChats(p.map((c) => c.id === m.chatId
          ? { ...c, lastMessage: m, lastMessageAt: m.createdAt, unreadCount: mine || isActive ? c.unreadCount : c.unreadCount + 1 }
          : c)));
        if (!mine && isActive) s!.emit('message:read', { chatId: m.chatId });
      });

      s.on('message:delivered', (d: { messageId: string; chatId: string; userId: string; at: string }) => {
        setMessages((p) => {
          const l = p[d.chatId];
          if (!l) return p;
          return { ...p, [d.chatId]: l.map((m) => m.id !== d.messageId ? m
            : { ...m, receipts: (m.receipts ?? []).map((r) => r.userId === d.userId ? { ...r, deliveredAt: d.at } : r) }) };
        });
      });

      s.on('message:read', (d: { chatId: string; userId: string; at: string }) => {
        setMessages((p) => {
          const l = p[d.chatId];
          if (!l) return p;
          return { ...p, [d.chatId]: l.map((m) => m.senderId !== meRef.current?.id ? m
            : { ...m, receipts: (m.receipts ?? []).map((r) => r.userId === d.userId ? { ...r, readAt: d.at, deliveredAt: r.deliveredAt ?? d.at } : r) }) };
        });
      });

      s.on('typing', (d: { chatId: string; typing: boolean }) => setTyping((p) => ({ ...p, [d.chatId]: d.typing })));
      s.on('presence', (d: { userId: string; online: boolean }) =>
        setOnline((p) => { const n = new Set(p); if (d.online) n.add(d.userId); else n.delete(d.userId); return n; }));
    })();
    return () => { cancelled = true; s?.disconnect(); };
  }, [loadChats]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, activeId]);

  async function openChat(id: string) {
    setActiveId(id); activeRef.current = id;
    const r = await api<{ items: Message[] }>('/chats/' + id + '/messages?limit=50');
    setMessages((p) => ({ ...p, [id]: r.items.slice().reverse() }));
    setChats((p) => p.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    socketRef.current?.emit('message:read', { chatId: id });
  }

  function send() {
    const body = text.trim();
    if (!body || !activeId) return;
    socketRef.current?.emit('message:send', { chatId: activeId, body, clientId: uid() }, (ack: { ok: boolean; error?: string }) => {
      if (!ack?.ok) alert(ack?.error ?? 'Send failed');
    });
    socketRef.current?.emit('typing', { chatId: activeId, typing: false });
    setText('');
  }

  function onType(v: string) {
    setText(v);
    if (!activeId) return;
    socketRef.current?.emit('typing', { chatId: activeId, typing: true });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current?.emit('typing', { chatId: activeId, typing: false }), 1500);
  }

  async function search() {
    if (q.trim().length < 3) return;
    setResults(await api<User[]>('/users/search?q=' + encodeURIComponent(q.trim())));
    setSearched(true);
  }

  async function startChat(userId: string) {
    const c = await api<Chat>('/chats/direct', { method: 'POST', body: { userId } });
    await loadChats();
    setQ(''); setResults([]); setSearched(false);
    openChat(c.id);
  }

  async function rename() {
    const n = window.prompt('Your name', me?.name ?? '');
    if (n && n.trim()) { const u = await api<User>('/users/me', { method: 'PATCH', body: { name: n.trim() } }); setMe(u); meRef.current = u; }
  }

  if (!me) return <div className="h-screen flex items-center justify-center bg-slate-950 text-slate-400">Loading...</div>;

  const active = chats.find((c) => c.id === activeId) ?? null;
  const other = active?.type === 'DIRECT' ? active.members.find((m) => m.userId !== me.id)?.user : null;
  const list = activeId ? messages[activeId] ?? [] : [];

  return (
    <div className="h-screen flex bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className={(activeId ? 'hidden md:flex ' : 'flex ') + 'w-full md:w-96 flex-col border-r border-slate-800 bg-slate-900'}>
        <div className="flex items-center justify-between p-3 bg-slate-800">
          <button onClick={rename} className="flex items-center gap-2">
            <span className="h-9 w-9 rounded-full bg-emerald-600 flex items-center justify-center font-bold">{(me.name || '?')[0].toUpperCase()}</span>
            <span className="font-medium">{me.name || 'Set your name'}</span>
          </button>
          <button onClick={onLogout} className="text-xs text-slate-400 hover:text-white">Log out</button>
        </div>
        <div className="p-3 space-y-2">
          <input className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 ring-emerald-500"
            placeholder="Find a user by exact email or phone, press Enter"
            value={q} onChange={(e) => { setQ(e.target.value); setSearched(false); }}
            onKeyDown={(e) => e.key === 'Enter' && search()} />
          {results.map((u) => (
            <button key={u.id} onClick={() => startChat(u.id)} className="w-full text-left rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm">
              Start chat with {u.name || q}
            </button>
          ))}
          {searched && results.length === 0 && <p className="text-xs text-slate-500">No user found. They must sign up first.</p>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {chats.length === 0 && <p className="p-4 text-sm text-slate-500">No chats yet. Search for a user above.</p>}
          {chats.map((c) => {
            const o = c.type === 'DIRECT' ? c.members.find((m) => m.userId !== me.id)?.user : null;
            return (
              <button key={c.id} onClick={() => openChat(c.id)}
                className={'w-full flex items-center gap-3 px-3 py-3 text-left border-b border-slate-800 hover:bg-slate-800 ' + (c.id === activeId ? 'bg-slate-800' : '')}>
                <span className="relative h-11 w-11 shrink-0 rounded-full bg-slate-700 flex items-center justify-center font-bold">
                  {titleOf(c, me.id)[0].toUpperCase()}
                  {o && online.has(o.id) && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-slate-900" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex justify-between">
                    <span className="font-medium truncate">{titleOf(c, me.id)}</span>
                    {c.lastMessage && <span className="text-xs text-slate-500">{fmt(c.lastMessage.createdAt)}</span>}
                  </span>
                  <span className="flex justify-between">
                    <span className="text-sm text-slate-400 truncate">
                      {typing[c.id] ? <em className="text-emerald-400">typing...</em> : c.lastMessage ? (c.lastMessage.deletedForAll ? 'Message deleted' : c.lastMessage.body) : 'No messages yet'}
                    </span>
                    {c.unreadCount > 0 && <span className="ml-2 rounded-full bg-emerald-600 text-xs px-2 py-0.5">{c.unreadCount}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Conversation */}
      <main className={(activeId ? 'flex ' : 'hidden md:flex ') + 'flex-1 flex-col'}>
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">Select a chat to start messaging</div>
        ) : (
          <>
            <header className="flex items-center gap-3 px-4 py-3 bg-slate-800">
              <button className="md:hidden text-slate-300" onClick={() => { setActiveId(null); activeRef.current = null; }}>Back</button>
              <span className="h-10 w-10 rounded-full bg-slate-700 flex items-center justify-center font-bold">{titleOf(active, me.id)[0].toUpperCase()}</span>
              <div className="flex-1">
                <div className="font-medium">{titleOf(active, me.id)}</div>
                <div className="text-xs text-slate-400">
                  {typing[active.id] ? <span className="text-emerald-400">typing...</span> : other ? (online.has(other.id) ? 'online' : 'offline') : active.members.length + ' members'}
                </div>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-950">
              {list.map((m) => {
                const mine = m.senderId === me.id;
                const st = mine ? statusOf(m, me.id) : null;
                return (
                  <div key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
                    <div className={'max-w-[75%] rounded-2xl px-3 py-2 text-sm ' + (mine ? 'bg-emerald-700 rounded-br-sm' : 'bg-slate-800 rounded-bl-sm')}>
                      {!mine && active.type === 'GROUP' && <div className="text-xs text-emerald-400">{m.sender?.name}</div>}
                      <span className="whitespace-pre-wrap break-words">{m.deletedForAll ? 'This message was deleted' : m.body}</span>
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-slate-300/70 align-bottom">
                        {fmt(m.createdAt)}
                        {st && <span className={st === 'read' ? 'text-sky-400' : ''}>{st === 'sent' ? TICK : TICK + TICK}</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 p-3 bg-slate-800">
              <input className="flex-1 rounded-full bg-slate-700 px-4 py-2 outline-none focus:ring-2 ring-emerald-500"
                placeholder="Type a message" value={text} onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button onClick={send} disabled={!text.trim()} className="rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-5 font-medium">Send</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
