/**
 * A small sliding-window rate limiter, kept in memory.
 *
 * Why: the demo is public and the Gemini key is ours. Without a limit, one
 * script could burn the whole free quota in a minute.
 *
 * KNOWN LIMITATION (say this in interviews and the README): on Vercel each
 * serverless instance has its OWN memory, and instances come and go. So this
 * limit is per instance, best effort. The production fix is a shared store
 * like Upstash Redis (free tier). For a portfolio demo, best effort is fine,
 * and being upfront about it is better than pretending.
 */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();

  return function check(key: string, now = Date.now()): RateLimitResult {
    // Keep only the timestamps inside the window.
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= limit) {
      hits.set(key, recent);
      const retryAfterMs = windowMs - (now - recent[0]!);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    recent.push(now);
    hits.set(key, recent);

    // Stop the map growing forever with one-off visitors.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return { ok: true };
  };
}
