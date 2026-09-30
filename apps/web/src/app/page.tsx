'use client';
import { useEffect, useState } from 'react';
import Login from '@/components/Login';
import ChatApp from '@/components/ChatApp';
import { api, getTokens, setTokens } from '@/lib/api';

export default function Page() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // Dev only: used by the load-test script to sign in test windows automatically.
    if (process.env.NODE_ENV !== 'production' && location.hash.startsWith('#dev=')) {
      try {
        const d = JSON.parse(atob(location.hash.slice(5)));
        setTokens({ accessToken: d.a, refreshToken: d.r });
        if (d.auto) sessionStorage.setItem('autoAccept', '1');
        history.replaceState(null, '', location.pathname);
      } catch {
        /* ignore a bad hash */
      }
    }
    setAuthed(!!getTokens());
    setReady(true);
  }, []);
  if (!ready) return null;

  function logout() {
    const t = getTokens();
    if (t) api('/auth/logout', { method: 'POST', body: { refreshToken: t.refreshToken } }).catch(() => {});
    setTokens(null);
    setAuthed(false);
  }

  return authed ? <ChatApp onLogout={logout} /> : <Login onDone={() => setAuthed(true)} />;
}
