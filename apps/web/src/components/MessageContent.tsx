'use client';
import { useState } from 'react';
import { API } from '@/lib/api';
import type { Message } from '@/lib/types';

export const mediaLabel = (m: Message) =>
  m.type === 'AUDIO' ? 'Voice message' : m.type === 'IMAGE' ? 'Photo' : m.type === 'VIDEO' ? 'Video' : m.type === 'DOCUMENT' ? 'Document' : '';

const kb = (n?: number | null) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');
const EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];
const act = 'rounded bg-black/30 hover:bg-black/50 px-2 py-0.5 text-xs';

type Props = { m: Message; meId: string; onReply: () => void; onEdit: () => void; onDelete: () => void; onReact: (emoji: string) => void };

export default function MessageContent({ m, meId, onReply, onEdit, onDelete, onReact }: Props) {
  const [open, setOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const mine = m.senderId === meId;
  const deleted = m.deletedForAll;
  const src = m.mediaUrl ? API + m.mediaUrl : null;

  const counts = new Map<string, { n: number; mine: boolean }>();
  (m.reactions ?? []).forEach((r) => {
    const c = counts.get(r.emoji) ?? { n: 0, mine: false };
    counts.set(r.emoji, { n: c.n + 1, mine: c.mine || r.userId === meId });
  });

  function toggle() {
    setCanEdit(mine && (m.type ?? 'TEXT') === 'TEXT' && Date.now() - new Date(m.createdAt).getTime() < 15 * 60_000);
    setOpen((o) => !o);
  }

  if (deleted) return <div className="italic text-slate-300">This message was deleted</div>;

  return (
    <div>
      {m.replyTo && (
        <div className="mb-1 rounded-lg bg-black/25 border-l-4 border-emerald-400 px-2 py-1 text-xs">
          <div className="text-emerald-300">{m.replyTo.sender?.name || 'User'}</div>
          <div className="truncate text-slate-300">
            {m.replyTo.deletedForAll ? 'Deleted message' : m.replyTo.body || 'Media'}
          </div>
        </div>
      )}
      {src && m.type === 'IMAGE' && (
        <a href={src} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={m.mediaName ?? 'image'} className="max-h-64 max-w-full rounded-lg mb-1" />
        </a>
      )}
      {src && m.type === 'VIDEO' && <video src={src} controls className="max-h-64 max-w-full rounded-lg mb-1" />}
      {src && m.type === 'AUDIO' && <audio src={src} controls className="max-w-full h-10 mb-1" />}
      {src && m.type === 'DOCUMENT' && (
        <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 mb-1 hover:bg-black/30">
          <span className="text-lg">DOC</span>
          <span className="min-w-0">
            <span className="block truncate text-sm">{m.mediaName ?? 'file'}</span>
            <span className="block text-xs text-slate-300">{kb(m.mediaSize)}</span>
          </span>
        </a>
      )}
      {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
      {m.editedAt && <span className="ml-1 text-[10px] text-slate-300/70">(edited)</span>}

      {counts.size > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {Array.from(counts.entries()).map(([emoji, c]) => (
            <button key={emoji} onClick={() => onReact(emoji)}
              className={'rounded-full px-2 py-0.5 text-xs ' + (c.mine ? 'bg-emerald-500/40' : 'bg-black/30')}>
              {emoji} {c.n}
            </button>
          ))}
        </div>
      )}

      <div className="mt-1">
        <button onClick={toggle} className="text-[10px] text-slate-300/60 hover:text-white">{open ? 'close' : 'options'}</button>
        {open && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => { onReact(e); setOpen(false); }} className="text-base hover:scale-125 transition">{e}</button>
            ))}
            <button className={act} onClick={() => { onReply(); setOpen(false); }}>Reply</button>
            {canEdit && <button className={act} onClick={() => { onEdit(); setOpen(false); }}>Edit</button>}
            {mine && <button className={act + ' text-red-300'} onClick={() => { onDelete(); setOpen(false); }}>Delete</button>}
          </div>
        )}
      </div>
    </div>
  );
}
