/**
 * Turn a raw AI SDK / Gemini error into an HTTP status and a message a user
 * can act on. Raw errors leak internals ("AI_RetryError: Failed after 3
 * attempts...") and don't say what to DO.
 */
export type FriendlyError = { status: number; message: string };

type ErrorLike = { message?: unknown; statusCode?: unknown; lastError?: unknown };

export function toFriendlyError(error: unknown): FriendlyError {
  // A RetryError wraps the real cause in `lastError`.
  const e = (error as ErrorLike | undefined)?.lastError ?? error;
  const message = String((e as ErrorLike | undefined)?.message ?? "");
  const status = (e as ErrorLike | undefined)?.statusCode;

  if (/high demand|overloaded|unavailable/i.test(message) || status === 503) {
    return { status: 503, message: "Gemini is busy right now. Wait a few seconds and press Retry." };
  }
  if (/quota|rate limit|resource.?exhausted/i.test(message) || status === 429) {
    return { status: 429, message: "The free Gemini limit was reached. Wait a minute and try again." };
  }
  if (/api key|permission|unauthenticated/i.test(message) || status === 401 || status === 403) {
    return { status: 500, message: "The Gemini API key is invalid. Check .env.local." };
  }
  if (/no longer available|not found/i.test(message) || status === 404) {
    return { status: 500, message: "The Gemini model isn't available for this key. Set GEMINI_MODEL in .env.local." };
  }
  return { status: 502, message: "The AI service failed. Please retry." };
}
