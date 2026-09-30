'use client';
import { useEffect, useState } from 'react';
import Login from '@/components/Login';
import ChatApp from '@/components/ChatApp';
import { api, getTokens, setTokens } from '@/lib/api';

export default function Page() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => { setAuthed(!!getTokens()); setReady(true); }, []);
  if (!ready) return null;

  function logout() {
    const t = getTokens();
    if (t) api('/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken } }).catch(() => {});
    setTokens(null);
    setAuthed(false);
  }

  return authed ? <ChatApp onLogout={logout} /> : <Login onDone={() => setAuthed(true)} />;
}
