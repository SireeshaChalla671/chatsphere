'use client';
import { useRef, useState } from 'react';
import { API, api, getTokens } from '@/lib/api';

export type MediaInfo = { type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT'; url: string; mime?: string; name?: string; size?: number };

async function upload(file: Blob, name: string): Promise<MediaInfo> {
  await api('/auth/me').catch(() => {}); // refreshes an expired token first
  const fd = new FormData();
  fd.append('file', file, name);
  const res = await fetch(API + '/media/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getTokens()?.accessToken },
    body: fd,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message ?? 'Upload failed');
  }
  return res.json();
}

export default function MediaButtons({ onSend }: { onSend: (m: MediaInfo) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { alert('Files are limited to 25 MB'); return; }
    setBusy(true);
    try { onSend(await upload(f, f.name)); } catch (err) { alert((err as Error).message); }
    setBusy(false);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        if (cancelled.current || !chunks.current.length) return;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        setBusy(true);
        try { onSend(await upload(blob, 'voice-message.' + (type.includes('mp4') ? 'm4a' : 'webm'))); } catch (err) { alert((err as Error).message); }
        setBusy(false);
      };
      rec.start();
      recRef.current = rec;
      setSecs(0);
      setRecording(true);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      alert('Microphone unavailable or permission denied');
    }
  }

  function stopRec(cancel: boolean) {
    cancelled.current = cancel;
    recRef.current?.stop();
  }

  if (recording) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="tabular-nums w-10">{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</span>
        <button onClick={() => stopRec(true)} className="rounded-full bg-slate-700 hover:bg-slate-600 px-3 py-1">Cancel</button>
        <button onClick={() => stopRec(false)} className="rounded-full bg-emerald-600 hover:bg-emerald-500 px-3 py-1">Send</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
      <button disabled={busy} onClick={() => fileRef.current?.click()} title="Attach a file"
        className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-2 text-sm">{busy ? '...' : 'Attach'}</button>
      <button disabled={busy} onClick={startRec} title="Record a voice message"
        className="rounded-full bg-slate-700 hover:bg-slate-600 disabled:opacity-40 px-3 py-2 text-sm">Mic</button>
    </div>
  );
}
