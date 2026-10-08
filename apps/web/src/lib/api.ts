export const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
type Tokens = { accessToken: string; refreshToken: string };

export const getTokens = (): Tokens | null => {
  try { return JSON.parse(localStorage.getItem('tokens') ?? 'null'); } catch { return null; }
};
export const setTokens = (t: Tokens | null) => {
  if (t) localStorage.setItem('tokens', JSON.stringify(t)); else localStorage.removeItem('tokens');
};

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const t = getTokens();
  const res = await fetch(API + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t.accessToken } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && retry && t) {
    const r = await fetch(API + '/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: t.refreshToken }),
    });
    if (r.ok) { setTokens(await r.json()); return api<T>(path, opts, false); }
    setTokens(null); location.reload();
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(Array.isArray(e.message) ? e.message.join(', ') : e.message ?? 'Request failed');
  }
  return res.json();
}
