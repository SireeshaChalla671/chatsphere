'use client';
import { useState } from 'react';
import { api, setTokens } from '@/lib/api';

export default function Login({ onDone }: { onDone: () => void }) {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'code'>('id');
  const [hint, setHint] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendOtp() {
    setErr(''); setBusy(true);
    try {
      const r = await api<{ devOtp?: string }>('/auth/send-otp', { method: 'POST', body: { identifier } });
      if (r.devOtp) { setHint(r.devOtp); setCode(r.devOtp); }
      setStep('code');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }
  async function verify() {
    setErr(''); setBusy(true);
    try {
      const r = await api<{ accessToken: string; refreshToken: string }>('/auth/verify-otp', { method: 'POST', body: { identifier, code } });
      setTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      onDone();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 p-4">
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl p-6 shadow-xl space-y-4">
        <h1 className="text-2xl font-bold text-emerald-400">ChatSphere</h1>
        <p className="text-sm text-slate-400">Sign in with your email or phone number.</p>
        <input className="w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 ring-emerald-500"
          placeholder="Email or phone" value={identifier} disabled={step === 'code'}
          onChange={(e) => setIdentifier(e.target.value)} />
        {step === 'code' && (
          <>
            <input className="w-full rounded-lg bg-slate-800 px-3 py-2 outline-none focus:ring-2 ring-emerald-500 tracking-widest"
              placeholder="6-digit code" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} />
            {hint && <p className="text-xs text-amber-400">Dev mode: your code is {hint} (auto-filled)</p>}
          </>
        )}
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button disabled={busy || identifier.length < 5}
          onClick={step === 'id' ? sendOtp : verify}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2 font-medium">
          {step === 'id' ? 'Send code' : 'Verify and continue'}
        </button>
        {step === 'code' && (
          <button className="text-xs text-slate-400 underline" onClick={() => { setStep('id'); setCode(''); setHint(''); }}>
            Use a different email or phone
          </button>
        )}
      </div>
    </div>
  );
}
