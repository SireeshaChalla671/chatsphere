'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Item = {
  id: string; chatId: string; type: 'VOICE' | 'VIDEO'; status: string;
  direction: 'incoming' | 'outgoing' | 'missed';
  initiator: { id: string; name: string }; createdAt: string; durationSeconds: number;
};

const dur = (s: number) => (s <= 0 ? '' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's');

export default function CallHistory({ onClose, onCallBack }: { onClose: () => void; onCallBack: (chatId: string, type: 'VOICE' | 'VIDEO') => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Item[]>('/calls/history').then(setItems).catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[80vh] flex flex-col bg-slate-900 text-slate-100 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Call history</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Close</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {err && <p className="p-4 text-sm text-red-400">{err}</p>}
          {!items && !err && <p className="p-4 text-sm text-slate-400">Loading...</p>}
          {items && items.length === 0 && <p className="p-4 text-sm text-slate-400">No calls yet.</p>}
          {items?.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
              <div className="flex-1 min-w-0">
                <div className={'font-medium truncate ' + (c.direction === 'missed' ? 'text-red-400' : '')}>{c.initiator.name || 'User'}</div>
                <div className="text-xs text-slate-400">
                  {c.direction === 'missed' ? 'Missed' : c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'}
                  {' - '}{c.type === 'VIDEO' ? 'Video' : 'Voice'}
                  {' - '}{new Date(c.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {dur(c.durationSeconds) && ' - ' + dur(c.durationSeconds)}
                </div>
              </div>
              <button onClick={() => onCallBack(c.chatId, c.type)} className="rounded-full bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs">Call back</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
