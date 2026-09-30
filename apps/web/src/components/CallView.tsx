'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Participant, Room, RoomEvent, Track } from 'livekit-client';
import { api } from '@/lib/api';

function Tile({ p, local, host, callId }: { p: Participant; local: boolean; host: boolean; callId: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const vt = p.getTrackPublication(Track.Source.ScreenShare)?.track ?? p.getTrackPublication(Track.Source.Camera)?.track;
    const at = p.getTrackPublication(Track.Source.Microphone)?.track;
    const ve = v.current;
    const ae = a.current;
    if (vt && ve) vt.attach(ve);
    if (!local && at && ae) at.attach(ae);
    return () => {
      if (vt && ve) vt.detach(ve);
      if (at && ae) at.detach(ae);
    };
  });

  const showVideo = p.isCameraEnabled || p.isScreenShareEnabled;
  return (
    <div className={'relative rounded-xl overflow-hidden bg-slate-800 aspect-video flex items-center justify-center ' + (p.isSpeaking ? 'ring-2 ring-emerald-400' : '')}>
      <video ref={v} autoPlay playsInline muted className={'h-full w-full object-cover ' + (showVideo ? '' : 'hidden ') + (local && !p.isScreenShareEnabled ? '-scale-x-100' : '')} />
      <audio ref={a} autoPlay />
      {!showVideo && (
        <div className="h-16 w-16 rounded-full bg-slate-600 flex items-center justify-center text-2xl font-bold">
          {(p.name || '?')[0]?.toUpperCase()}
        </div>
      )}
            {host && !local && (
        <div className="absolute top-1 right-1 flex gap-1">
          <button className="text-xs bg-black/60 hover:bg-black/80 rounded px-2 py-0.5" onClick={() => api('/calls/' + callId + '/mute/' + p.identity, { method: 'POST' }).catch(() => {})}>Mute</button>
          <button className="text-xs bg-red-700/80 hover:bg-red-600 rounded px-2 py-0.5" onClick={() => api('/calls/' + callId + '/remove/' + p.identity, { method: 'POST' }).catch(() => {})}>Remove</button>
        </div>
      )}
      <div className="absolute bottom-1 left-2 text-xs bg-black/60 rounded px-2 py-0.5">
        {p.name || 'User'}{local ? ' (you)' : ''}{!p.isMicrophoneEnabled ? ' - muted' : ''}
      </div>
    </div>
  );
}

type Props = {
  token: string; url: string; type: 'VOICE' | 'VIDEO'; title: string; isHost: boolean; callId: string;
  onLeave: () => void; onEndAll: () => void;
};

export default function CallView({ token, url, type, title, isHost, callId, onLeave, onEndAll }: Props) {
  const roomRef = useRef<Room | null>(null);
  const leaveRef = useRef(onLeave);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);

  useEffect(() => { leaveRef.current = onLeave; });

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const events = [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged,
    ];
    events.forEach((e) => room.on(e, bump as never));
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) leaveRef.current(); });

    (async () => {
      try {
        await room.connect(url, token);
        if (cancelled) { room.disconnect(); return; }
        setStatus('live');
        bump();
        await room.localParticipant.setMicrophoneEnabled(true).catch(() => setErr('Microphone unavailable'));
        if (type === 'VIDEO') {
          await room.localParticipant.setCameraEnabled(true).catch(() => setErr('Camera unavailable (another window may be using it)'));
        }
        bump();
      } catch (e) {
        if (!cancelled) { setStatus('error'); setErr((e as Error).message); }
      }
    })();

    return () => { cancelled = true; room.disconnect(); };
  }, [url, token, type]);

  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const room = roomRef.current;
  const lp = room?.localParticipant;
  const parts: Participant[] = room ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())] : [];
  const n = parts.length;
  const cols = n <= 1 ? 'grid-cols-1 max-w-xl mx-auto w-full' : n <= 4 ? 'grid-cols-1 sm:grid-cols-2' : n <= 9 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4';
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const btn = 'rounded-full px-4 py-2 text-sm font-medium ';

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900">
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-xs text-slate-400">
            {status === 'connecting' ? 'Connecting...' : status === 'error' ? 'Connection failed' : mm + ':' + ss}
            {' - '}{n}/10 participants
          </div>
        </div>
        {err && <div className="text-xs text-amber-400 max-w-xs text-right">{err}</div>}
      </div>

      <div className={'flex-1 overflow-auto p-3 grid gap-3 content-center ' + cols}>
        {parts.map((p) => <Tile key={p.identity} p={p} local={p === lp} host={isHost} callId={callId} />)}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 p-4 bg-slate-900">
        <button className={btn + (lp?.isMicrophoneEnabled ? 'bg-slate-700' : 'bg-red-600')}
          onClick={() => lp?.setMicrophoneEnabled(!lp.isMicrophoneEnabled).then(() => bump()).catch(() => {})}>
          {lp?.isMicrophoneEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button className={btn + (lp?.isCameraEnabled ? 'bg-slate-700' : 'bg-red-600')}
          onClick={() => lp?.setCameraEnabled(!lp.isCameraEnabled).then(() => bump()).catch(() => setErr('Camera unavailable'))}>
          {lp?.isCameraEnabled ? 'Camera off' : 'Camera on'}
        </button>
        <button className={btn + (lp?.isScreenShareEnabled ? 'bg-emerald-700' : 'bg-slate-700')}
          onClick={() => lp?.setScreenShareEnabled(!lp.isScreenShareEnabled).then(() => bump()).catch(() => {})}>
          {lp?.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}
        </button>
        <button className={btn + 'bg-red-600 hover:bg-red-500'} onClick={onLeave}>Leave</button>
        {isHost && <button className={btn + 'bg-red-800 hover:bg-red-700'} onClick={onEndAll}>End for all</button>}
      </div>
    </div>
  );
}
