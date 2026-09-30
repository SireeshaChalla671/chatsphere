'use client';
import { API } from '@/lib/api';
import type { Message } from '@/lib/types';

export const mediaLabel = (m: Message) =>
  m.type === 'AUDIO' ? 'Voice message' : m.type === 'IMAGE' ? 'Photo' : m.type === 'VIDEO' ? 'Video' : m.type === 'DOCUMENT' ? 'Document' : '';

const kb = (n?: number | null) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');

export default function MessageContent({ m }: { m: Message }) {
  if (m.deletedForAll) return <span className="italic text-slate-300">This message was deleted</span>;
  const src = m.mediaUrl ? API + m.mediaUrl : null;
  return (
    <span className="block">
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
    </span>
  );
}
