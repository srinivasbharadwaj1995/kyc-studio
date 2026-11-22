import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { toFriendlyError } from "@/lib/ai/errors";
import { GEMINI_MODEL, guardRequest, jsonError } from "@/lib/api/http";
import { createRateLimiter } from "@/lib/api/rateLimit";
import { aiReviewSchema, buildCheckPrompt, CHECK_SYSTEM_PROMPT, toCheckIssues } from "@/lib/checks/aiReview";
import { runRuleChecks } from "@/lib/checks/rules";
import { formSchema } from "@/lib/schema/zod";

/**
 * POST /api/check  { schema: FormSchema }  →  { issues: CheckIssue[] }  (AI issues only)
 *
 * Not streamed: the panel shows issues all at once, and a short JSON answer
 * comes back in a few seconds. The client runs the rule checks itself, instantly;
 * this route adds the AI's extra findings on top.
 */
export const maxDuration = 30;

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// The schema comes from the browser, so it's validated with the FULL Zod schema.
const requestSchema = z.object({ schema: formSchema });

export async function POST(req: Request) {
  const guarded = await guardRequest(req, { limiter, schema: requestSchema });
  if (!guarded.ok) return guarded.response;
  const { schema } = guarded.data;

  try {
    // Re-run the rules HERE rather than trusting a list sent by the client.
    const ruleIssues = runRuleChecks(schema);
    const { output } = await generateText({
      model: google(GEMINI_MODEL),
      system: CHECK_SYSTEM_PROMPT,
      prompt: buildCheckPrompt(schema, ruleIssues),
      output: Output.object({ schema: aiReviewSchema }),
      temperature: 0.2,
      maxRetries: 1,
      abortSignal: req.signal,
    });
    return Response.json({ issues: toCheckIssues(output, schema) });
  } catch (error) {
    console.error("[/api/check]", error);
    const { status, message } = toFriendlyError(error);
    return jsonError(status, message);
  }
}
