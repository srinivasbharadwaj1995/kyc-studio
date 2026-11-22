import { z } from "zod";
import type { CheckIssue } from "./rules";
import type { SchemaOp } from "@/lib/schema/ops";
import type { FormSchema } from "@/lib/schema/types";

/**
 * The AI review's answer format. Like aiFormSchema, it's deliberately FLAT
 * (no unions, no regexes) so Gemini can enforce it.
 *
 * The AI can't write arbitrary SchemaOps. It picks one of a few SAFE actions,
 * and our code turns that into a real op. It can rename or remove a field,
 * but never invent new field types, rewrite showIf, or touch ids.
 */
export const FIX_ACTIONS = [
  "none",
  "remove_field",
  "update_label",
  "update_help_text",
  "make_optional",
  "make_required",
  "mark_sensitive",
] as const;

export const aiReviewSchema = z.object({
  issues: z.array(
    z.object({
      severity: z.enum(["high", "medium", "low"]),
      fieldId: z.string().describe("Affected field id, or empty string for the whole form"),
      message: z.string().describe("One sentence: what's wrong and why it matters"),
      fixAction: z.enum(FIX_ACTIONS),
      fixValue: z.string().describe("New label or help text for update_* actions, else empty string"),
    }),
  ),
});

export type AiReview = z.infer<typeof aiReviewSchema>;

export const CHECK_SYSTEM_PROMPT = `
You review KYC and onboarding form schemas for Indian fintech products.
You are given the form's purpose, its schema, and issues our rule engine ALREADY found.

Find up to 6 ADDITIONAL issues that rules can't judge:
- Data minimisation: a field that isn't needed for the stated purpose (suggest remove_field).
- Unclear labels or jargon an average Indian customer may not understand (suggest update_label or update_help_text).
- Fields marked required that most users can't or shouldn't have to answer (suggest make_optional).
- Personal data that should be masked but isn't (suggest mark_sensitive).

Rules:
- Do NOT repeat the issues already found.
- Use only field ids that exist in the schema.
- Be conservative. If the form is fine, return an empty list. Don't invent problems.
- severity: high = privacy/legal risk, medium = hurts completion, low = polish.
- These are developer hints, not legal advice. Never claim RBI or legal compliance.
`.trim();

export function buildCheckPrompt(schema: FormSchema, ruleIssues: CheckIssue[]): string {
  const already = ruleIssues.length ? ruleIssues.map((i) => `- ${i.message}`).join("\n") : "- (none)";
  return `Purpose: ${schema.purpose}\n\nSchema:\n${JSON.stringify(schema)}\n\nAlready found by rules:\n${already}`;
}

function toOp(action: AiReview["issues"][number]["fixAction"], fieldId: string, value: string): SchemaOp | null {
  const text = value.trim();
  switch (action) {
    case "remove_field":
      return { op: "removeField", fieldId };
    case "update_label":
      return text ? { op: "updateField", fieldId, changes: { label: text.slice(0, 80) } } : null;
    case "update_help_text":
      return text ? { op: "updateField", fieldId, changes: { helpText: text.slice(0, 200) } } : null;
    case "make_optional":
      return { op: "updateField", fieldId, changes: { required: false } };
    case "make_required":
      return { op: "updateField", fieldId, changes: { required: true } };
    case "mark_sensitive":
      return { op: "updateField", fieldId, changes: { sensitive: true } };
    case "none":
      return null;
  }
}

const FIX_LABELS: Record<(typeof FIX_ACTIONS)[number], string> = {
  none: "",
  remove_field: "Remove this field",
  update_label: "Use suggested label",
  update_help_text: "Add suggested help text",
  make_optional: "Make optional",
  make_required: "Make required",
  mark_sensitive: "Mark as sensitive",
};

/**
 * Turn the AI's answer into CheckIssues we can trust:
 * unknown field ids are dropped, text is length-capped, at most 6 issues.
 * The fix op is still Zod-checked again by applyOp when the user clicks it.
 */
export function toCheckIssues(review: AiReview, schema: FormSchema): CheckIssue[] {
  const fieldIds = new Set(schema.steps.flatMap((s) => s.fields.map((f) => f.id)));
  const stepOf = new Map(schema.steps.flatMap((s) => s.fields.map((f) => [f.id, s.id] as const)));

  return review.issues
    .filter((i) => i.fieldId === "" || fieldIds.has(i.fieldId))
    .filter((i) => i.message.trim().length > 0)
    .slice(0, 6)
    .map((i, n) => {
      const op = i.fieldId ? toOp(i.fixAction, i.fieldId, i.fixValue) : null;
      return {
        id: `ai:${n}:${i.fieldId}:${i.fixAction}`,
        ruleId: `ai_${i.fixAction}`,
        severity: i.severity,
        message: i.message.trim().slice(0, 300),
        fieldId: i.fieldId || undefined,
        stepId: i.fieldId ? stepOf.get(i.fieldId) : undefined,
        fix: op ? { label: FIX_LABELS[i.fixAction], op } : undefined,
        source: "ai" as const,
      };
    });
}
