import { uniqueId } from "@/lib/schema/ids";
import type { SchemaOp } from "@/lib/schema/ops";
import type { Field, FieldType, FormSchema, Step } from "@/lib/schema/types";

/**
 * Rule-based compliance, privacy and drop-off checks. NO AI here.
 *
 * Why rules first? They're instant, free, deterministic and unit-testable:
 * "full Aadhaar collected" is either true or false. The AI review (/api/check)
 * runs AFTER and only adds what rules can't judge, like "is this field really
 * needed for the stated purpose?". Rules are reliable; AI adds reasoning.
 *
 * Reminder for the README: these are developer hints, not legal/RBI advice.
 */

export type Severity = "high" | "medium" | "low";

export type CheckIssue = {
  /** Stable id (rule + field), so React keys and "dismiss" survive re-runs. */
  id: string;
  ruleId: string;
  severity: Severity;
  message: string;
  fieldId?: string;
  stepId?: string;
  /** One-click fix. Applied through the store, so it's undoable and Zod-checked. */
  fix?: { label: string; op: SchemaOp };
  source: "rule" | "ai";
};

export type RiskLevel = "low" | "medium" | "high";
export type StepRisk = {
  stepId: string;
  risk: RiskLevel;
  reasons: string[];
  fix?: { label: string; op: SchemaOp };
};

/** Fields that identify a person or their money: need consent and masking. */
const SENSITIVE_TYPES: ReadonlySet<FieldType> = new Set(["pan", "aadhaar_last4", "bank_account"]);
/** "Hard" fields: asking these first makes people quit. */
const DOCUMENT_TYPES: ReadonlySet<FieldType> = new Set(["pan", "gstin", "aadhaar_last4", "bank_account", "ifsc"]);

const MAX_FIELDS_PER_STEP = 6;
const MAX_STEPS = 5;

/**
 * Does this look like a FULL Aadhaar field? The schema has no "aadhaar" type,
 * so a full Aadhaar can only sneak in as text/number with "aadhaar" in it.
 */
function looksLikeFullAadhaar(field: Field): boolean {
  if (field.type === "aadhaar_last4" || field.type === "consent" || field.type === "checkbox") return false;
  return /aadhaa?r|\buid\b/i.test(`${field.id} ${field.label}`);
}

export function runRuleChecks(schema: FormSchema): CheckIssue[] {
  const issues: CheckIssue[] = [];
  let consentSeen = false; // consent anywhere EARLIER in the flow counts

  for (const step of schema.steps) {
    step.fields.forEach((field, index) => {
      // 1. Full Aadhaar: collecting all 12 digits is a serious privacy risk.
      if (looksLikeFullAadhaar(field)) {
        issues.push({
          id: `full_aadhaar:${field.id}`,
          ruleId: "full_aadhaar",
          severity: "high",
          fieldId: field.id,
          stepId: step.id,
          message: `"${field.label}" may collect the full Aadhaar number. Collect only the last 4 digits.`,
          fix: {
            label: "Ask for last 4 digits only",
            op: {
              op: "updateField",
              fieldId: field.id,
              changes: { type: "aadhaar_last4", label: "Last 4 digits of Aadhaar", sensitive: true, rules: undefined },
            },
          },
          source: "rule",
        });
      }

      const isSensitive = SENSITIVE_TYPES.has(field.type) || looksLikeFullAadhaar(field);

      // 2. Sensitive data collected before any consent checkbox.
      if (isSensitive && !consentSeen) {
        issues.push({
          id: `missing_consent:${field.id}`,
          ruleId: "missing_consent",
          severity: "high",
          fieldId: field.id,
          stepId: step.id,
          message: `"${field.label}" is collected without a consent checkbox before it.`,
          fix: {
            label: "Add a consent checkbox before it",
            op: {
              op: "addField",
              stepId: step.id,
              index,
              field: {
                id: uniqueId(schema, `consent_${field.id}`),
                type: "consent",
                label: `I agree to share my ${field.label} for KYC verification`,
                required: true,
              },
            },
          },
          source: "rule",
        });
        consentSeen = true; // one consent covers what follows; don't flag every field after it
      }

      // 3. Sensitive data shown in clear text.
      if (SENSITIVE_TYPES.has(field.type) && !field.sensitive) {
        issues.push({
          id: `not_masked:${field.id}`,
          ruleId: "not_masked",
          severity: "medium",
          fieldId: field.id,
          stepId: step.id,
          message: `"${field.label}" is sensitive but not marked for masking.`,
          fix: { label: "Mark as sensitive", op: { op: "updateField", fieldId: field.id, changes: { sensitive: true } } },
          source: "rule",
        });
      }

      // 4. An optional consent checkbox is meaningless: unticked = no consent.
      if (field.type === "consent" && !field.required) {
        issues.push({
          id: `optional_consent:${field.id}`,
          ruleId: "optional_consent",
          severity: "medium",
          fieldId: field.id,
          stepId: step.id,
          message: `Consent "${field.label}" is optional, so users can continue without agreeing.`,
          fix: { label: "Make consent required", op: { op: "updateField", fieldId: field.id, changes: { required: true } } },
          source: "rule",
        });
      }

      if (field.type === "consent" && field.required) consentSeen = true;
    });
  }

  // 5. Too many steps (form-level).
  if (schema.steps.length > MAX_STEPS) {
    issues.push({
      id: "too_many_steps",
      ruleId: "too_many_steps",
      severity: "low",
      message: `${schema.steps.length} steps is long. Flows over ${MAX_STEPS} steps lose more users.`,
      source: "rule",
    });
  }

  return issues;
}

function stepRisk(step: Step, index: number): StepRisk {
  let risk: RiskLevel = "low";
  const reasons: string[] = [];
  const raise = (to: RiskLevel) => {
    if (to === "high" || (to === "medium" && risk === "low")) risk = to;
  };

  const count = step.fields.length;
  let fix: StepRisk["fix"];
  if (count > MAX_FIELDS_PER_STEP) {
    raise("high");
    reasons.push(`${count} fields in one step (keep it to ${MAX_FIELDS_PER_STEP} or fewer)`);
    const atIndex = Math.ceil(count / 2);
    fix = { label: "Split into two steps", op: { op: "splitStep", stepId: step.id, atIndex } };
  }

  const documents = step.fields.filter((f) => DOCUMENT_TYPES.has(f.type));
  if (index === 0 && documents.length > 0) {
    raise("medium");
    reasons.push(`Step 1 asks for ${documents.map((f) => f.label).join(", ")}. Ask easy fields first`);
  }

  const required = step.fields.filter((f) => f.required).length;
  if (count >= 4 && required === count) {
    raise("medium");
    reasons.push("Every field is required");
  }

  return { stepId: step.id, risk, reasons: reasons.length ? reasons : ["Looks easy to complete"], fix };
}

/** Drop-off risk per step: simple, explainable heuristics (not real analytics yet). */
export function computeStepRisks(schema: FormSchema): StepRisk[] {
  return schema.steps.map(stepRisk);
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const bySeverity = (a: CheckIssue, b: CheckIssue) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
