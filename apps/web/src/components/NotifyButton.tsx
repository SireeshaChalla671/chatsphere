'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

function keyBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function NotifyButton() {
  const [state, setState] = useState<'hidden' | 'off' | 'on' | 'denied'>('hidden');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    navigator.serviceWorker.ready
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setState(Notification.permission === 'denied' ? 'denied' : sub ? 'on' : 'off');
      })
      .catch(() => {});
  }, []);

  async function enable() {
    try {
      const { key } = await api<{ key: string | null }>('/push/key');
      if (!key) { alert('Push is not configured on the server'); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(key) as unknown as BufferSource,
      });
      await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
      setState('on');
    } catch (e) {
      alert('Could not enable notifications: ' + (e as Error).message);
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      /* ignore */
    }
  }

  if (state === 'hidden') return null;
  if (state === 'denied') return <span className="text-xs text-slate-500" title="Allow notifications in the browser site settings">Notify blocked</span>;
  return (
    <button onClick={state === 'on' ? disable : enable} className="text-xs text-slate-400 hover:text-white">
      {state === 'on' ? 'Notify: on' : 'Notify'}
    </button>
  );
}
