import { describe, expect, it } from "vitest";
import { aiFormSchema, parseFormSchema } from "./zod";
import { samplePersonalLoan } from "./sample";
import type { FormSchema } from "./types";
import geminiPersonalLoan from "./fixtures/gemini-personal-loan.json";

// Deep copy so each test can break the sample without affecting others.
const clone = (): FormSchema => structuredClone(samplePersonalLoan);

const messages = (data: unknown) => {
  const r = parseFormSchema(data);
  return r.ok ? [] : r.issues.map((i) => i.message);
};

describe("parseFormSchema", () => {
  it("accepts the valid sample", () => {
    expect(parseFormSchema(samplePersonalLoan).ok).toBe(true);
  });

  it("never throws on garbage input", () => {
    for (const junk of [null, undefined, 42, "text", [], { steps: "no" }]) {
      expect(parseFormSchema(junk).ok).toBe(false);
    }
  });

  it("rejects an unknown field type (AI hallucination)", () => {
    const s = clone() as unknown as { steps: { fields: { type: string }[] }[] };
    s.steps[0]!.fields[0]!.type = "full_aadhaar";
    expect(parseFormSchema(s).ok).toBe(false);
  });

  it("strips an AI-provided regex pattern instead of trusting it", () => {
    const s = clone();
    (s.steps[0]!.fields[0]!.rules as Record<string, unknown>).pattern = "(a+)+$";
    const r = parseFormSchema(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.schema.steps[0]!.fields[0]!.rules).not.toHaveProperty("pattern");
  });

  it("rejects duplicate field ids across steps", () => {
    const s = clone();
    s.steps[2]!.fields[3]!.id = "full_name";
    expect(messages(s)).toContain('Duplicate field id "full_name"');
  });

  it("rejects showIf pointing to a missing field", () => {
    const s = clone();
    s.steps[2]!.fields[1]!.showIf = { fieldId: "ghost", equals: "x" };
    expect(messages(s).join()).toMatch(/not an earlier field/);
  });

  it("rejects showIf pointing forwards", () => {
    const s = clone();
    // The first field of step 1 depends on a field in step 3.
    s.steps[0]!.fields[0]!.showIf = { fieldId: "employment_type", equals: "salaried" };
    expect(messages(s).join()).toMatch(/not an earlier field/);
  });

  it("rejects showIf.equals that is not a valid option", () => {
    const s = clone();
    s.steps[2]!.fields[1]!.showIf = { fieldId: "employment_type", equals: "freelancer" };
    expect(messages(s).join()).toMatch(/not an option/);
  });

  it("requires options for radio/select", () => {
    const s = clone();
    delete s.steps[2]!.fields[0]!.options;
    expect(messages(s).join()).toMatch(/at least 2 options/);
  });

  it("rejects min greater than max", () => {
    const s = clone();
    s.steps[0]!.fields[0]!.rules = { min: 10, max: 2 };
    expect(messages(s).join()).toMatch(/min is greater/);
  });

  it("rejects non snake_case ids", () => {
    const s = clone();
    s.steps[0]!.fields[0]!.id = "Full Name";
    expect(parseFormSchema(s).ok).toBe(false);
  });

  it("rejects empty labels and too many steps", () => {
    const s = clone();
    s.steps[0]!.fields[0]!.label = "  ";
    expect(messages(s)).toContain("Must not be empty");

    const many = clone();
    many.steps = Array.from({ length: 9 }, (_, i) => ({ ...many.steps[0]!, id: `step_${i}`, fields: [] }));
    expect(messages(many)).toContain("Must have 1 to 8 steps");
  });

  it("accepts a real response recorded from Gemini", () => {
    expect(parseFormSchema(geminiPersonalLoan)).toMatchObject({ ok: true });
  });
});

describe("aiFormSchema (the contract sent to Gemini)", () => {
  it("converts to plain JSON Schema with no pattern in rules", () => {
    const json = JSON.stringify(aiFormSchema.toJSONSchema());
    // A `pattern` *property* would appear as "pattern":{...}. The id regex
    // constraint appears as "pattern":"..." and is fine (that's our regex, not the AI's).
    expect(json).not.toContain('"pattern":{');
    expect(json).toContain("aadhaar_last4");
  });
});
