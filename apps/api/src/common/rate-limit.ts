type Req = { ip?: string; path: string };
type Res = { status: (n: number) => { json: (b: unknown) => void } };

// Small in-memory limiter per IP. For several servers, move the counters to Redis.
export function rateLimit(opts: { windowMs: number; max: number; authMax: number }) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();

  return (req: Req, res: Res, next: () => void) => {
    const auth = req.path.startsWith('/auth/send-otp') || req.path.startsWith('/auth/verify-otp');
    const key = (req.ip ?? 'unknown') + (auth ? ':auth' : '');
    const limit = auth ? opts.authMax : opts.max;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + opts.windowMs });
      return next();
    }
    h.n++;
    if (h.n > limit) return res.status(429).json({ message: 'Too many requests, slow down' });
    next();
  };
}
