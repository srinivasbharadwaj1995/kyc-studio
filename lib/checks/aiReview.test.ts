import { describe, expect, it } from "vitest";
import { buildCheckPrompt, toCheckIssues, type AiReview } from "./aiReview";
import { applyOp } from "@/lib/schema/ops";
import { samplePersonalLoan as sample } from "@/lib/schema/sample";

const issue = (over: Partial<AiReview["issues"][number]>): AiReview["issues"][number] => ({
  severity: "medium",
  fieldId: "dob",
  message: "Something",
  fixAction: "none",
  fixValue: "",
  ...over,
});

describe("toCheckIssues", () => {
  it("drops issues that point to fields that don't exist (hallucinated ids)", () => {
    const out = toCheckIssues({ issues: [issue({ fieldId: "ghost" }), issue({ fieldId: "dob" })] }, sample);
    expect(out.map((i) => i.fieldId)).toEqual(["dob"]);
  });

  it("turns safe actions into SchemaOps that actually apply", () => {
    const out = toCheckIssues(
      {
        issues: [
          issue({ fieldId: "monthly_income", fixAction: "update_help_text", fixValue: "Your take-home pay after tax" }),
          issue({ fieldId: "dob", fixAction: "make_optional" }),
        ],
      },
      sample,
    );
    expect(out[0]).toMatchObject({ source: "ai", stepId: "income", fix: { label: "Add suggested help text" } });
    for (const i of out) expect(applyOp(sample, i.fix!.op).ok).toBe(true);
  });

  it("gives no fix when the action needs text but none was given", () => {
    expect(toCheckIssues({ issues: [issue({ fixAction: "update_label", fixValue: "  " })] }, sample)[0]!.fix).toBeUndefined();
  });

  it("allows form-level issues without a fix, and caps at 6", () => {
    const many = Array.from({ length: 10 }, () => issue({ fieldId: "", fixAction: "remove_field" }));
    const out = toCheckIssues({ issues: many }, sample);
    expect(out).toHaveLength(6);
    expect(out[0]!.fix).toBeUndefined();
  });
});

describe("buildCheckPrompt", () => {
  it("includes the purpose and tells the AI what rules already found", () => {
    const prompt = buildCheckPrompt(sample, [
      { id: "x", ruleId: "x", severity: "high", message: "PAN has no consent", source: "rule" },
    ]);
    expect(prompt).toContain(sample.purpose);
    expect(prompt).toContain("PAN has no consent");
  });
});
