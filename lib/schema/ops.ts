import type { Field, FormSchema, Step } from "./types";
import { parseFormSchema } from "./zod";

/**
 * Every change to a schema is one of these operations. Nothing edits the
 * schema directly. The same small set powers:
 *  - "Fix it" (the AI returns an op, we apply it)       → Week 2
 *  - the visual editor (drag = moveField, edit = updateField) → Week 3
 *  - chat refinement ("split step 2" = splitStep)       → Week 3
 *  - undo/redo (every op is one history entry)          → now
 *
 * Why typed ops instead of letting the AI return a whole new schema?
 * An op is small, easy to validate, easy to show the user ("Mark PAN as
 * sensitive"), and it can't silently change parts of the form nobody asked about.
 */
export type SchemaOp =
  // `id` can't change here: other fields' showIf may point to it.
  | { op: "updateField"; fieldId: string; changes: Partial<Omit<Field, "id">> }
  | { op: "addField"; stepId: string; index: number; field: Field }
  | { op: "removeField"; fieldId: string }
  | { op: "moveField"; fieldId: string; toStepId: string; index: number }
  // Fields from `atIndex` onwards move into a new step right after this one.
  | { op: "splitStep"; stepId: string; atIndex: number; newStepId?: string; newStepTitle?: string }
  // Step-level ops for the editor (Week 3). A step needs ≥1 field, so addStep takes one.
  | { op: "updateStep"; stepId: string; changes: { title: string } }
  | { op: "addStep"; index: number; step: Step }
  | { op: "removeStep"; stepId: string };

export type ApplyResult = { ok: true; schema: FormSchema } | { ok: false; error: string };

function locateField(schema: FormSchema, fieldId: string) {
  for (const [stepIndex, step] of schema.steps.entries()) {
    const fieldIndex = step.fields.findIndex((f) => f.id === fieldId);
    if (fieldIndex !== -1) return { step, stepIndex, fieldIndex };
  }
  return null;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Remove keys whose value is undefined, so `{ showIf: undefined }` really removes showIf. */
function withoutUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Apply one op and return a NEW schema. The input is never mutated, which is
 * what makes undo trivial: the old schema is still there, untouched.
 *
 * The result must pass the full Zod check. An op that would break the schema
 * (e.g. removing a field another field's showIf depends on) is rejected with
 * a reason, and the caller keeps the old schema.
 */
export function applyOp(schema: FormSchema, op: SchemaOp): ApplyResult {
  const next = structuredClone(schema);

  switch (op.op) {
    case "updateField": {
      const at = locateField(next, op.fieldId);
      if (!at) return { ok: false, error: `Field "${op.fieldId}" not found` };
      at.step.fields[at.fieldIndex] = withoutUndefined({ ...at.step.fields[at.fieldIndex]!, ...op.changes });
      break;
    }
    case "addField": {
      const step = next.steps.find((s) => s.id === op.stepId);
      if (!step) return { ok: false, error: `Step "${op.stepId}" not found` };
      step.fields.splice(clamp(op.index, 0, step.fields.length), 0, op.field);
      break;
    }
    case "removeField": {
      const at = locateField(next, op.fieldId);
      if (!at) return { ok: false, error: `Field "${op.fieldId}" not found` };
      at.step.fields.splice(at.fieldIndex, 1);
      break;
    }
    case "moveField": {
      const at = locateField(next, op.fieldId);
      const target = next.steps.find((s) => s.id === op.toStepId);
      if (!at) return { ok: false, error: `Field "${op.fieldId}" not found` };
      if (!target) return { ok: false, error: `Step "${op.toStepId}" not found` };
      const [field] = at.step.fields.splice(at.fieldIndex, 1);
      target.fields.splice(clamp(op.index, 0, target.fields.length), 0, field!);
      break;
    }
    case "splitStep": {
      const stepIndex = next.steps.findIndex((s) => s.id === op.stepId);
      const step = next.steps[stepIndex];
      if (!step) return { ok: false, error: `Step "${op.stepId}" not found` };
      if (op.atIndex < 1 || op.atIndex >= step.fields.length) {
        return { ok: false, error: "Split point must leave at least one field in each step" };
      }
      const moved = step.fields.splice(op.atIndex);
      next.steps.splice(stepIndex + 1, 0, {
        id: op.newStepId ?? `${step.id}_2`,
        title: op.newStepTitle ?? `${step.title} (continued)`,
        fields: moved,
      });
      break;
    }
    case "updateStep": {
      const step = next.steps.find((s) => s.id === op.stepId);
      if (!step) return { ok: false, error: `Step "${op.stepId}" not found` };
      step.title = op.changes.title;
      break;
    }
    case "addStep": {
      next.steps.splice(clamp(op.index, 0, next.steps.length), 0, op.step);
      break;
    }
    case "removeStep": {
      const stepIndex = next.steps.findIndex((s) => s.id === op.stepId);
      if (stepIndex === -1) return { ok: false, error: `Step "${op.stepId}" not found` };
      next.steps.splice(stepIndex, 1);
      break;
    }
  }

  const checked = parseFormSchema(next);
  if (!checked.ok) {
    const first = checked.issues[0]!;
    return { ok: false, error: `${first.message}${first.path ? ` (at ${first.path})` : ""}` };
  }
  return { ok: true, schema: checked.schema };
}
