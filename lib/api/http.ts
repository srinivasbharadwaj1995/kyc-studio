import type { z } from "zod";
import type { RateLimitResult } from "./rateLimit";

/**
 * Shared plumbing for our AI routes, so each route only contains its own logic.
 * All three routes do the same checks, in the same order, cheapest first:
 *   rate limit → API key present → request body valid → (only then) call Gemini
 */

export const jsonError = (status: number, error: string, headers?: HeadersInit) =>
  Response.json({ error }, { status, headers });

/** Best-effort client IP. Vercel and most proxies set x-forwarded-for. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

type Guarded<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function guardRequest<T>(
  req: Request,
  { limiter, schema }: { limiter: (key: string) => RateLimitResult; schema: z.ZodType<T> },
): Promise<Guarded<T>> {
  const limited = limiter(clientIp(req));
  if (!limited.ok) {
    return {
      ok: false,
      response: jsonError(429, `Too many requests. Try again in ${limited.retryAfterSeconds}s.`, {
        "Retry-After": String(limited.retryAfterSeconds),
      }),
    };
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { ok: false, response: jsonError(500, "The server has no Gemini API key. Add it to .env.local and restart.") };
  }

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return { ok: false, response: jsonError(400, body.error.issues[0]?.message ?? "Invalid request") };
  }
  return { ok: true, data: body.data };
}

/** One place to choose the model; override with GEMINI_MODEL in .env.local. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
