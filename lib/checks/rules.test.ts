import { describe, expect, it } from "vitest";
import { computeStepRisks, runRuleChecks } from "./rules";
import { applyOp } from "@/lib/schema/ops";
import { samplePersonalLoan as sample } from "@/lib/schema/sample";
import type { Field, FormSchema } from "@/lib/schema/types";
import geminiPersonalLoan from "@/lib/schema/fixtures/gemini-personal-loan.json";

const ruleIds = (s: FormSchema) => runRuleChecks(s).map((i) => i.ruleId);

/** Apply an issue's fix and return the new schema (fails the test if the fix is invalid). */
function applyFix(schema: FormSchema, ruleId: string): FormSchema {
  const issue = runRuleChecks(schema).find((i) => i.ruleId === ruleId);
  if (!issue?.fix) throw new Error(`No fix for ${ruleId}`);
  const result = applyOp(schema, issue.fix.op);
  if (!result.ok) throw new Error(result.error);
  return result.schema;
}

/** A one-step form with exactly these fields (no other steps, so no id clashes). */
function withStep1(fields: Field[]): FormSchema {
  return { name: "Test", purpose: "Testing", steps: [{ id: "s1", title: "S1", fields }] };
}

describe("runRuleChecks", () => {
  it("finds nothing wrong with the well-designed sample", () => {
    expect(runRuleChecks(sample)).toEqual([]);
  });

  it("finds nothing wrong with the real Gemini answer", () => {
    expect(ruleIds(geminiPersonalLoan as FormSchema)).toEqual([]);
  });

  it("flags full Aadhaar as high severity, and the fix resolves it", () => {
    const s = withStep1([
      { id: "consent", type: "consent", label: "I agree", required: true },
      { id: "aadhaar_number", type: "text", label: "Aadhaar number", required: true },
    ]);
    const issue = runRuleChecks(s).find((i) => i.ruleId === "full_aadhaar");
    expect(issue).toMatchObject({ severity: "high", fieldId: "aadhaar_number" });

    const fixed = applyFix(s, "full_aadhaar");
    expect(fixed.steps[0]!.fields[1]).toMatchObject({ type: "aadhaar_last4", sensitive: true });
    expect(ruleIds(fixed)).not.toContain("full_aadhaar");
  });

  it("flags PAN without consent before it, and the fix adds consent in the right place", () => {
    const s = withStep1([
      { id: "full_name", type: "text", label: "Name", required: true },
      { id: "pan_number", type: "pan", label: "PAN", required: true, sensitive: true },
    ]);
    expect(ruleIds(s)).toContain("missing_consent");

    const fixed = applyFix(s, "missing_consent");
    expect(fixed.steps[0]!.fields.map((f) => f.type)).toEqual(["text", "consent", "pan"]);
    expect(ruleIds(fixed)).not.toContain("missing_consent");
  });

  it("a consent in an earlier step covers later sensitive fields", () => {
    // The sample has consent in step 2, and bank_account in step 3: no issue.
    expect(ruleIds(sample)).not.toContain("missing_consent");
  });

  it("an OPTIONAL consent doesn't count as consent", () => {
    const s = withStep1([
      { id: "consent", type: "consent", label: "I agree", required: false },
      { id: "pan_number", type: "pan", label: "PAN", required: true, sensitive: true },
    ]);
    expect(ruleIds(s)).toEqual(expect.arrayContaining(["optional_consent", "missing_consent"]));
    expect(ruleIds(applyFix(s, "optional_consent"))).toEqual([]);
  });

  it("flags unmasked sensitive fields, and the fix masks them", () => {
    const s = structuredClone(sample);
    delete s.steps[1]!.fields[1]!.sensitive; // PAN
    expect(runRuleChecks(s)).toEqual([expect.objectContaining({ ruleId: "not_masked", severity: "medium", fieldId: "pan_number" })]);
    expect(ruleIds(applyFix(s, "not_masked"))).toEqual([]);
  });

  it("flags more than 5 steps", () => {
    const s = structuredClone(sample);
    const extra = (i: number) => ({ id: `x${i}`, title: `X${i}`, fields: [{ id: `f${i}`, type: "text" as const, label: "F", required: false }] });
    s.steps.push(extra(1), extra(2), extra(3));
    expect(ruleIds(s)).toContain("too_many_steps");
  });

  it("issue ids are stable across runs (needed for React keys)", () => {
    const s = withStep1([{ id: "pan_number", type: "pan", label: "PAN", required: true }]);
    expect(runRuleChecks(s).map((i) => i.id)).toEqual(runRuleChecks(s).map((i) => i.id));
  });
});

describe("computeStepRisks", () => {
  it("rates the sample's steps", () => {
    const risks = computeStepRisks(sample);
    expect(risks.map((r) => r.risk)).toEqual(["low", "low", "medium"]); // step 3: all 5 fields required
  });

  it("rates more than 6 fields as high, and the split fix lowers it", () => {
    const fields: Field[] = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, type: "text", label: `F${i}`, required: false }));
    const s = withStep1(fields);
    const [risk] = computeStepRisks(s);
    expect(risk).toMatchObject({ risk: "high", reasons: [expect.stringMatching(/8 fields/)] });

    const split = applyOp(s, risk!.fix!.op);
    expect(split.ok).toBe(true);
    if (split.ok) expect(computeStepRisks(split.schema).slice(0, 2).map((r) => r.risk)).toEqual(["low", "low"]);
  });

  it("rates documents in step 1 as medium", () => {
    const s = withStep1([
      { id: "consent", type: "consent", label: "I agree", required: true },
      { id: "pan_number", type: "pan", label: "PAN", required: true, sensitive: true },
    ]);
    expect(computeStepRisks(s)[0]).toMatchObject({ risk: "medium", reasons: [expect.stringMatching(/Step 1 asks for PAN/)] });
  });
});
