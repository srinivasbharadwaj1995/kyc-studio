import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import { toFriendlyError } from "@/lib/ai/errors";
import { GEMINI_MODEL, guardRequest, jsonError } from "@/lib/api/http";
import { createRateLimiter } from "@/lib/api/rateLimit";
import { FIELD_TYPES } from "@/lib/schema/zod";

/**
 * POST /api/explain  { label, type, purpose }  →  { explanation }
 *
 * PRIVACY: the request carries the field's LABEL and TYPE only, never what
 * the customer typed. The schema below has no `value` key, and Zod strips
 * unknown keys, so even a buggy client can't send a PAN to Gemini through here.
 */
export const maxDuration = 20;

// Explanations are cheap and cached, so a higher limit than generate/check.
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

const requestSchema = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  purpose: z.string().trim().max(300).default(""),
});

const SYSTEM = `
You help Indian customers fill in KYC and onboarding forms.
Explain the given form field in exactly 2 short, plain-language sentences:
1) what it is and where to find it (e.g. "printed on your PAN card"),
2) why it's usually asked.
No jargon, no markdown, no greetings. Never ask the user to share it with you.
`.trim();

// Same field + purpose = same answer, so don't pay for it twice.
// Per-instance memory, like the rate limiter: best effort, and fine for a demo.
const cache = new Map<string, string>();
const CACHE_LIMIT = 500;

export async function POST(req: Request) {
  const guarded = await guardRequest(req, { limiter, schema: requestSchema });
  if (!guarded.ok) return guarded.response;
  const { label, type, purpose } = guarded.data;

  const key = `${type}|${label.toLowerCase()}|${purpose.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return Response.json({ explanation: cached, cached: true });

  try {
    const { text, finishReason } = await generateText({
      model: google(GEMINI_MODEL),
      system: SYSTEM,
      prompt: `Field label: "${label}"\nField type: ${type}\nForm purpose: ${purpose || "customer onboarding"}`,
      temperature: 0.3,
      // No maxOutputTokens: Gemini 3.x "thinks" first, and that thinking counts
      // against the cap. A 200-token cap cut answers off mid-sentence in testing.
      // We cap the TEXT length below instead.
      maxRetries: 1,
      abortSignal: req.signal,
    });
    const explanation = text.trim().slice(0, 500);
    if (!explanation) return jsonError(502, "No explanation came back. Please retry.");

    // Only cache complete answers, or one bad answer gets served forever.
    if (finishReason === "stop") {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!); // drop the oldest entry
      cache.set(key, explanation);
    }
    return Response.json({ explanation, cached: false });
  } catch (error) {
    console.error("[/api/explain]", error);
    const { status, message } = toFriendlyError(error);
    return jsonError(status, message);
  }
}
