import { describe, expect, it } from "vitest";
import { applyOp, type ApplyResult } from "./ops";
import { samplePersonalLoan as sample } from "./sample";
import type { FormSchema } from "./types";

const ok = (r: ApplyResult): FormSchema => {
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.schema;
};
const ids = (s: FormSchema, step: number) => s.steps[step]!.fields.map((f) => f.id);

describe("applyOp", () => {
  it("never mutates the input schema (this is what makes undo safe)", () => {
    const before = structuredClone(sample);
    applyOp(sample, { op: "removeField", fieldId: "dob" });
    applyOp(sample, { op: "updateField", fieldId: "full_name", changes: { label: "Name" } });
    expect(sample).toEqual(before);
  });

  it("updateField merges changes, and undefined removes a key", () => {
    const s = ok(applyOp(sample, { op: "updateField", fieldId: "mobile", changes: { sensitive: true, helpText: "For OTP" } }));
    expect(s.steps[0]!.fields[2]).toMatchObject({ id: "mobile", sensitive: true, helpText: "For OTP" });

    const cleared = ok(applyOp(sample, { op: "updateField", fieldId: "gstin", changes: { showIf: undefined } }));
    expect(cleared.steps[2]!.fields[1]).not.toHaveProperty("showIf");
  });

  it("addField inserts at the index (clamped to the step's length)", () => {
    const field = { id: "email", type: "email" as const, label: "Email", required: false };
    expect(ids(ok(applyOp(sample, { op: "addField", stepId: "basic_details", index: 1, field })), 0)).toEqual([
      "full_name",
      "email",
      "dob",
      "mobile",
    ]);
    expect(ids(ok(applyOp(sample, { op: "addField", stepId: "basic_details", index: 99, field })), 0).at(-1)).toBe("email");
  });

  it("removeField removes it", () => {
    expect(ids(ok(applyOp(sample, { op: "removeField", fieldId: "dob" })), 0)).toEqual(["full_name", "mobile"]);
  });

  it("moveField moves within and across steps", () => {
    const within = ok(applyOp(sample, { op: "moveField", fieldId: "mobile", toStepId: "basic_details", index: 0 }));
    expect(ids(within, 0)).toEqual(["mobile", "full_name", "dob"]);

    const across = ok(applyOp(sample, { op: "moveField", fieldId: "mobile", toStepId: "identity", index: 0 }));
    expect(ids(across, 0)).toEqual(["full_name", "dob"]);
    expect(ids(across, 1)[0]).toBe("mobile");
  });

  it("splitStep moves the tail of a step into a new step after it", () => {
    const s = ok(applyOp(sample, { op: "splitStep", stepId: "income", atIndex: 3 }));
    expect(s.steps).toHaveLength(4);
    expect(ids(s, 2)).toEqual(["employment_type", "gstin", "monthly_income"]);
    expect(s.steps[3]).toMatchObject({ id: "income_2", title: "Income and bank (continued)" });
    expect(ids(s, 3)).toEqual(["ifsc", "account_number"]);
  });

  it("updateStep, addStep and removeStep", () => {
    const renamed = ok(applyOp(sample, { op: "updateStep", stepId: "identity", changes: { title: "Your ID" } }));
    expect(renamed.steps[1]!.title).toBe("Your ID");

    const step = { id: "extra", title: "Extra", fields: [{ id: "notes", type: "text" as const, label: "Notes", required: false }] };
    expect(ok(applyOp(sample, { op: "addStep", index: 1, step })).steps.map((s) => s.id)).toEqual([
      "basic_details",
      "extra",
      "identity",
      "income",
    ]);

    // Removing step 1 is fine: nothing depends on its fields.
    expect(ok(applyOp(sample, { op: "removeStep", stepId: "basic_details" })).steps).toHaveLength(2);
  });

  describe("rejects ops that would break the schema", () => {
    it("an empty step title, the last step, or a step whose fields others depend on", () => {
      expect(applyOp(sample, { op: "updateStep", stepId: "identity", changes: { title: " " } }).ok).toBe(false);
      const oneStep = { ...sample, steps: [sample.steps[0]!] };
      expect(applyOp(oneStep, { op: "removeStep", stepId: "basic_details" }).ok).toBe(false);
    });

    it("unknown ids", () => {
      expect(applyOp(sample, { op: "removeField", fieldId: "ghost" })).toEqual({ ok: false, error: 'Field "ghost" not found' });
      expect(applyOp(sample, { op: "moveField", fieldId: "dob", toStepId: "ghost", index: 0 }).ok).toBe(false);
    });

    it("removing a field that another field's showIf depends on", () => {
      const r = applyOp(sample, { op: "removeField", fieldId: "employment_type" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/not an earlier field/);
    });

    it("moving a field below the field that depends on it", () => {
      const r = applyOp(sample, { op: "moveField", fieldId: "employment_type", toStepId: "income", index: 5 });
      expect(r.ok).toBe(false);
    });

    it("emptying a step", () => {
      const r = applyOp(
        { ...sample, steps: [sample.steps[0]!, { id: "solo", title: "Solo", fields: [sample.steps[1]!.fields[0]!] }] },
        { op: "moveField", fieldId: "kyc_consent", toStepId: "basic_details", index: 0 },
      );
      expect(r.ok).toBe(false);
    });

    it("a split that leaves a step empty", () => {
      expect(applyOp(sample, { op: "splitStep", stepId: "income", atIndex: 0 }).ok).toBe(false);
      expect(applyOp(sample, { op: "splitStep", stepId: "income", atIndex: 5 }).ok).toBe(false);
    });

    it("adding a duplicate id", () => {
      const field = { id: "dob", type: "date" as const, label: "Again", required: false };
      expect(applyOp(sample, { op: "addField", stepId: "income", index: 0, field }).ok).toBe(false);
    });
  });
});
