'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API, api, getTokens } from '@/lib/api';
import CallView from '@/components/CallView';

type CallInfo = { id: string; chatId: string; type: 'VOICE' | 'VIDEO'; initiatorId: string };
type Incoming = { call: CallInfo; fromName: string; chatTitle?: string | null };
type Joined = { call: CallInfo; token: string; url: string; title: string; isHost: boolean };

export function useCalls(meId: string | undefined) {
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [error, setError] = useState('');
  const joinedRef = useRef<Joined | null>(null);

  useEffect(() => { joinedRef.current = joined; }, [joined]);

  useEffect(() => {
    if (!meId) return;
    const s = io(API, { auth: (cb) => cb({ token: getTokens()?.accessToken }) });
    s.on('call:incoming', (d: Incoming) => { if (!joinedRef.current) setIncoming(d); });
    s.on('call:ended', (d: { callId: string }) => {
      setIncoming((p) => (p?.call.id === d.callId ? null : p));
      if (joinedRef.current?.call.id === d.callId) setJoined(null);
    });
    return () => { s.disconnect(); };
  }, [meId]);

  const start = useCallback(async (chatId: string, type: 'VOICE' | 'VIDEO', title: string) => {
    setError('');
    try {
      const r = await api<{ call: CallInfo; token: string; url: string }>('/calls', { method: 'POST', body: { chatId, type } });
      setJoined({ call: r.call, token: r.token, url: r.url, title, isHost: true });
    } catch (e) { setError((e as Error).message); }
  }, []);

  async function accept() {
    if (!incoming) return;
    const inc = incoming;
    setIncoming(null);
    try {
      const r = await api<{ call: CallInfo; token: string; url: string }>('/calls/' + inc.call.id + '/join', { method: 'POST' });
      setJoined({ call: r.call, token: r.token, url: r.url, title: inc.chatTitle ?? inc.fromName, isHost: false });
    } catch (e) { setError((e as Error).message); }
  }

  function decline() {
    if (!incoming) return;
    api('/calls/' + incoming.call.id + '/decline', { method: 'POST' }).catch(() => {});
    setIncoming(null);
  }

  function leave() {
    const j = joinedRef.current;
    setJoined(null);
    if (j) api('/calls/' + j.call.id + '/leave', { method: 'POST' }).catch(() => {});
  }

  function endAll() {
    const j = joinedRef.current;
    setJoined(null);
    if (j) api('/calls/' + j.call.id + '/end', { method: 'POST' }).catch(() => {});
  }

  const overlay = (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-red-600 text-white text-sm px-4 py-2 rounded-lg cursor-pointer" onClick={() => setError('')}>
          {error}
        </div>
      )}
      {incoming && !joined && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center">
          <div className="bg-slate-900 text-slate-100 rounded-2xl p-6 w-80 text-center space-y-4 shadow-2xl">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-600 flex items-center justify-center text-2xl font-bold animate-pulse">
              {(incoming.fromName || '?')[0].toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-lg">{incoming.fromName}</div>
              <div className="text-sm text-slate-400">Incoming {incoming.call.type === 'VIDEO' ? 'video' : 'voice'} call{incoming.chatTitle ? ' in ' + incoming.chatTitle : ''}</div>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={decline} className="rounded-full bg-red-600 hover:bg-red-500 px-5 py-2 font-medium">Decline</button>
              <button onClick={accept} className="rounded-full bg-emerald-600 hover:bg-emerald-500 px-5 py-2 font-medium">Accept</button>
            </div>
          </div>
        </div>
      )}
      {joined && (
        <CallView key={joined.call.id} token={joined.token} url={joined.url} type={joined.call.type}
          title={joined.title} isHost={joined.isHost} callId={joined.call.id} onLeave={leave} onEndAll={endAll} />
      )}
    </>
  );

  return { start, overlay };
}
