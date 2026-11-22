import { google } from "@ai-sdk/google";
import { createTextStreamResponse, Output, streamText, toTextStream } from "ai";
import { z } from "zod";
import { toFriendlyError } from "@/lib/ai/errors";
import { GENERATE_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { GEMINI_MODEL, guardRequest, jsonError } from "@/lib/api/http";
import { createRateLimiter } from "@/lib/api/rateLimit";
import { aiFormSchema } from "@/lib/schema/zod";

/**
 * POST /api/generate  { prompt: string }  →  streamed FormSchema JSON
 *
 * This runs on the SERVER only. The browser never sees the API key:
 * it talks to this route, and only this route talks to Gemini.
 */

// Allow streaming responses for up to 30 seconds on Vercel.
export const maxDuration = 30;

// 10 generations per minute per IP (best effort; see rateLimit.ts).
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// Never trust the request body either: validate it like the AI's output.
const requestSchema = z.object({
  prompt: z.string().trim().min(10, "Describe the flow in at least 10 characters").max(1000, "Keep it under 1000 characters"),
});

export async function POST(req: Request) {
  const guarded = await guardRequest(req, { limiter, schema: requestSchema });
  if (!guarded.ok) return guarded.response;

  let failure: unknown;
  const result = streamText({
    model: google(GEMINI_MODEL),
    system: GENERATE_SYSTEM_PROMPT,
    prompt: guarded.data.prompt,
    // Forces Gemini to answer in OUR JSON shape (structured output).
    output: Output.object({ schema: aiFormSchema }),
    // Low temperature: we want consistent, rule-following forms, not creativity.
    temperature: 0.2,
    // One retry only: each retry burns free quota and time (maxDuration is 30s).
    maxRetries: 1,
    // If the user presses Stop or closes the tab, stop paying for Gemini too.
    abortSignal: req.signal,
    onError: ({ error }) => {
      failure = error;
      console.error("[/api/generate]", error);
    },
  });

  // Wait for the FIRST chunk before answering. Once we start streaming, the
  // HTTP status is locked at 200, so an error that happens before any text
  // arrives must be caught here and sent as a proper error response.
  const reader = toTextStream({ stream: result.stream }).getReader();
  let first = await reader.read();
  while (!first.done && first.value === "") first = await reader.read();

  if (first.done) {
    const { status, message } = toFriendlyError(failure);
    return jsonError(status, message);
  }

  const firstChunk = first.value;
  const stream = new ReadableStream<string>({
    start(controller) {
      controller.enqueue(firstChunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return createTextStreamResponse({ stream });
}
