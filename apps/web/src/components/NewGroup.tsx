'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function NewGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (chatId: string) => void }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setErr(''); setBusy(true);
    const identifiers = members.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    try {
      const c = await api<{ id: string }>('/chats/group', { method: 'POST', body: { name: name.trim(), identifiers } });
      onCreated(c.id);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 text-slate-100 rounded-2xl p-5 space-y-3 shadow-2xl">
        <h2 className="text-lg font-semibold">New group</h2>
        <input className="w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 ring-emerald-500"
          placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="w-full h-28 rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none focus:ring-2 ring-emerald-500"
          placeholder={'Members: exact emails or phones, one per line or comma separated'}
          value={members} onChange={(e) => setMembers(e.target.value)} />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600">Cancel</button>
          <button onClick={create} disabled={busy || !name.trim() || !members.trim()}
            className="rounded-lg px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">Create</button>
        </div>
      </div>
    </div>
  );
}
