'use client';
import { useEffect, useRef, useState } from 'react';
import { API, api, getTokens } from '@/lib/api';

type S = { id: string; body: string | null; bgColor: string | null; mediaUrl: string | null; mediaType: string | null; createdAt: string; viewed: boolean; viewCount: number };
type Group = { user: { id: string; name: string }; statuses: S[]; allViewed: boolean };
type Viewer = { id: string; name: string; viewedAt: string };

const COLORS = ['#047857', '#1d4ed8', '#7c3aed', '#be123c', '#b45309', '#0f172a'];
const ago = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago';
};

async function upload(file: File): Promise<{ type: string; url: string }> {
  await api('/auth/me').catch(() => {}); // refreshes an expired token first
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch(API + '/media/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getTokens()?.accessToken },
    body: fd,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

function Viewer({ group, mine, onClose }: { group: Group; mine: boolean; onClose: (changed: boolean) => void }) {
  const [i, setI] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const s = group.statuses[i];
  const last = group.statuses.length - 1;
  const next = () => (i < last ? setI(i + 1) : onClose(false));
  const prev = () => setI(Math.max(0, i - 1));

  useEffect(() => {
    setViewers(null);
    if (!mine) api('/status/' + s.id + '/view', { method: 'POST' }).catch(() => {});
    if (s.mediaType === 'VIDEO') return;
    const t = setTimeout(next, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id]);

  async function showViewers() {
    setViewers(await api<Viewer[]>('/status/' + s.id + '/viewers').catch(() => []));
  }
  async function remove() {
    if (!confirm('Delete this status?')) return;
    await api('/status/' + s.id, { method: 'DELETE' }).catch(() => {});
    onClose(true);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black text-white flex flex-col">
      <div className="flex gap-1 p-2">
        {group.statuses.map((x, k) => (
          <div key={x.id} className={'h-1 flex-1 rounded ' + (k <= i ? 'bg-white' : 'bg-white/30')} />
        ))}
      </div>
      <div className="flex items-center justify-between px-4 py-2 text-sm">
        <span>{mine ? 'My status' : group.user.name || 'User'} <span className="text-white/60">{ago(s.createdAt)}</span></span>
        <button onClick={() => onClose(false)} className="text-white/70 hover:text-white">Close</button>
      </div>

      <div className="relative flex-1 flex items-center justify-center overflow-hidden"
        style={{ background: s.mediaUrl ? '#000' : s.bgColor ?? '#0f172a' }}>
        {s.mediaUrl && s.mediaType === 'VIDEO' && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={s.id} src={API + s.mediaUrl} autoPlay controls onEnded={next} className="max-h-full max-w-full" />
        )}
        {s.mediaUrl && s.mediaType !== 'VIDEO' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={API + s.mediaUrl} alt="status" className="max-h-full max-w-full object-contain" />
        )}
        {s.body && (
          <p className={s.mediaUrl ? 'absolute bottom-6 left-0 right-0 text-center px-6 text-lg bg-black/50 py-2' : 'text-2xl text-center px-8 whitespace-pre-wrap break-words'}>
            {s.body}
          </p>
        )}
        <button aria-label="Previous" onClick={prev} className="absolute left-0 top-0 h-3/4 w-1/4" />
        {s.mediaType !== 'VIDEO' && <button aria-label="Next" onClick={next} className="absolute right-0 top-0 h-3/4 w-1/4" />}
      </div>

      {mine && (
        <div className="p-3 bg-slate-900 text-sm">
          <div className="flex items-center justify-between">
            <button onClick={showViewers} className="text-emerald-400">Viewed by {s.viewCount}</button>
            <button onClick={remove} className="text-red-400">Delete</button>
          </div>
          {viewers && (
            <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
              {viewers.length === 0 && <p className="text-slate-400">No views yet</p>}
              {viewers.map((v) => <div key={v.id} className="text-slate-200">{v.name || 'User'} <span className="text-slate-500">{ago(v.viewedAt)}</span></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StatusPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{ mine: Group | null; others: Group[] } | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ group: Group; mine: boolean } | null>(null);
  const [text, setText] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [media, setMedia] = useState<{ url: string; type: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api<{ mine: Group | null; others: Group[] }>('/status').then(setData).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) { setErr('Choose a photo or video'); return; }
    setBusy(true); setErr('');
    try { const r = await upload(f); setMedia({ url: r.url, type: r.type, name: f.name }); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }

  async function post() {
    setBusy(true); setErr('');
    try {
      await api('/status', { method: 'POST', body: { body: text.trim() || undefined, bgColor: color, mediaUrl: media?.url, mediaType: media?.type } });
      setText(''); setMedia(null);
      await load();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-slate-900 text-slate-100 rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold">Status</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm">Close</button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="p-4 border-b border-slate-800 space-y-2">
            <div className="rounded-lg p-3 text-center min-h-20 flex items-center justify-center" style={{ background: media ? '#1e293b' : color }}>
              {media ? <span className="text-sm">{media.type === 'VIDEO' ? 'Video' : 'Photo'} ready: {media.name}</span>
                : <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={700} placeholder="Type a status..."
                    className="w-full bg-transparent text-center outline-none resize-none placeholder-white/60" rows={2} />}
            </div>
            {media && (
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={700} placeholder="Add a caption (optional)"
                className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm outline-none" />
            )}
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} aria-label={'Colour ' + c} onClick={() => setColor(c)} style={{ background: c }}
                  className={'h-6 w-6 rounded-full ' + (c === color ? 'ring-2 ring-white' : '')} />
              ))}
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={pick} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="ml-auto rounded-full bg-slate-700 hover:bg-slate-600 px-3 py-1 text-xs">Photo/Video</button>
              <button onClick={post} disabled={busy || (!text.trim() && !media)} className="rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-4 py-1 text-xs font-medium">Post</button>
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
          </div>

          {data?.mine && (
            <button onClick={() => setOpen({ group: data.mine as Group, mine: true })}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-800 hover:bg-slate-800 text-left">
              <span className="h-11 w-11 rounded-full ring-2 ring-emerald-500 bg-slate-700 flex items-center justify-center font-bold">Me</span>
              <span>
                <span className="block font-medium">My status</span>
                <span className="block text-xs text-slate-400">{data.mine.statuses.length} update(s), expires in 24h</span>
              </span>
            </button>
          )}

          {!data && !err && <p className="p-4 text-sm text-slate-400">Loading...</p>}
          {data && data.others.length === 0 && <p className="p-4 text-sm text-slate-500">No recent updates from your contacts.</p>}
          {data?.others.map((g) => (
            <button key={g.user.id} onClick={() => setOpen({ group: g, mine: false })}
              className="w-full flex items-center gap-3 px-4 py-3 border-b border-slate-800 hover:bg-slate-800 text-left">
              <span className={'h-11 w-11 rounded-full bg-slate-700 flex items-center justify-center font-bold ring-2 ' + (g.allViewed ? 'ring-slate-600' : 'ring-emerald-500')}>
                {(g.user.name || '?')[0].toUpperCase()}
              </span>
              <span>
                <span className="block font-medium">{g.user.name || 'User'}</span>
                <span className="block text-xs text-slate-400">{ago(g.statuses[g.statuses.length - 1].createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {open && <Viewer key={open.group.user.id} group={open.group} mine={open.mine} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}
