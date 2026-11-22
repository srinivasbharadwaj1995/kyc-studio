import { z } from "zod";

/**
 * The form schema is the single source of truth for KYC Studio.
 * The AI writes it, the editor changes it, the renderer draws it,
 * the checks read it and the exporter turns it into code.
 *
 * There are two layers:
 *  1. `aiFormSchema`: the shape only. It is sent to Gemini as the
 *     structured-output contract, so it must stay simple: no unions,
 *     no refinements (Gemini supports only part of JSON Schema).
 *  2. `formSchema`: the same shape plus cross-field rules (`superRefine`)
 *     that JSON Schema can't express. It runs on our side after the AI answers.
 */

export const FIELD_TYPES = [
  "text",
  "email",
  "mobile",
  "date",
  "number",
  "select",
  "radio",
  "checkbox",
  "pan",
  "gstin",
  "ifsc",
  "aadhaar_last4",
  "pincode",
  "bank_account",
  "consent",
] as const;

/** Field types whose value must be one of `options`. */
export const OPTION_FIELD_TYPES = ["select", "radio"] as const;

/*
 * Why the shape below has no regexes and no min/max lengths:
 * Gemini compiles the schema into a grammar that it enforces token by token.
 * Each regex or length limit multiplies the grammar's size, and our first
 * real test failed with "schema produces a constraint that has too many states".
 * So the shape stays plain, and those rules live in `superRefine` further down.
 * Nothing is lost: they still run on every response, just on our side.
 */

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

/**
 * Note there is no `pattern` here on purpose.
 * Regexes come only from lib/validators/india.ts, picked by field type.
 * An AI-written regex could be wrong, or slow enough to freeze the browser (ReDoS).
 */
const rulesSchema = z.object({
  min: z.number().optional().describe("Min length for text, min value for number"),
  max: z.number().optional().describe("Max length for text, max value for number"),
  message: z.string().optional(),
});

const showIfSchema = z.object({
  fieldId: z.string().describe("Id of an earlier field"),
  equals: z.string().describe('Option value, or "true" for a checkbox'),
});

const fieldSchema = z.object({
  id: z.string().describe("snake_case, unique"),
  type: z.enum(FIELD_TYPES),
  label: z.string(),
  helpText: z.string().optional(),
  required: z.boolean(),
  sensitive: z.boolean().optional(),
  options: z.array(optionSchema).optional().describe("For select and radio"),
  rules: rulesSchema.optional(),
  showIf: showIfSchema.optional(),
});

const stepSchema = z.object({
  id: z.string().describe("snake_case, unique"),
  title: z.string(),
  fields: z.array(fieldSchema),
});

/** Shape-only schema. This is what we hand to the AI SDK. */
export const aiFormSchema = z.object({
  name: z.string(),
  purpose: z.string().describe("Why the data is collected"),
  steps: z.array(stepSchema),
});

// Rules Gemini can't enforce cheaply; checked in superRefine below.
// snake_case ids keep the exported React code readable: register("pan_number").
const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = {
  steps: { min: 1, max: 8 },
  fieldsPerStep: { min: 1, max: 15 },
  name: 80,
  purpose: 300,
  title: 60,
  label: 80,
  helpText: 200,
  option: 60,
  message: 120,
} as const;

/** Full schema: shape + cross-field rules. Use this to validate anything before it becomes app state. */
export const formSchema = aiFormSchema.superRefine((schema, ctx) => {
  type Path = (string | number)[];
  const fail = (path: Path, message: string) => ctx.addIssue({ code: "custom", path, message });

  // Text must be non-empty and not too long. Returns nothing; just records issues.
  const checkText = (value: string | undefined, max: number, path: Path, optional = false) => {
    if (value === undefined) return;
    if (!optional && value.trim() === "") fail(path, "Must not be empty");
    else if (value.length > max) fail(path, `Must be at most ${max} characters`);
  };
  const checkId = (id: string, path: Path) => {
    if (!ID_PATTERN.test(id)) fail(path, `"${id}" must be snake_case, start with a letter, max 40 chars`);
  };

  checkText(schema.name, LIMITS.name, ["name"]);
  checkText(schema.purpose, LIMITS.purpose, ["purpose"]);
  const { min: minSteps, max: maxSteps } = LIMITS.steps;
  if (schema.steps.length < minSteps || schema.steps.length > maxSteps) {
    fail(["steps"], `Must have ${minSteps} to ${maxSteps} steps`);
  }

  const stepIds = new Set<string>();
  // Fields seen so far, in order. Used to check that showIf only looks backwards.
  const seenFields = new Map<string, z.infer<typeof fieldSchema>>();

  schema.steps.forEach((step, s) => {
    if (stepIds.has(step.id)) {
      ctx.addIssue({ code: "custom", path: ["steps", s, "id"], message: `Duplicate step id "${step.id}"` });
    }
    stepIds.add(step.id);
    checkId(step.id, ["steps", s, "id"]);
    checkText(step.title, LIMITS.title, ["steps", s, "title"]);
    const { min: minFields, max: maxFields } = LIMITS.fieldsPerStep;
    if (step.fields.length < minFields || step.fields.length > maxFields) {
      fail(["steps", s, "fields"], `A step must have ${minFields} to ${maxFields} fields`);
    }

    step.fields.forEach((field, f) => {
      const path = ["steps", s, "fields", f];
      checkId(field.id, [...path, "id"]);
      checkText(field.label, LIMITS.label, [...path, "label"]);
      checkText(field.helpText, LIMITS.helpText, [...path, "helpText"], true);
      checkText(field.rules?.message, LIMITS.message, [...path, "rules", "message"], true);
      field.options?.forEach((o, i) => {
        checkText(o.label, LIMITS.option, [...path, "options", i, "label"]);
        checkText(o.value, LIMITS.option, [...path, "options", i, "value"]);
      });

      // 1. Field ids must be unique across ALL steps (they become form keys).
      if (seenFields.has(field.id)) {
        ctx.addIssue({ code: "custom", path: [...path, "id"], message: `Duplicate field id "${field.id}"` });
      }

      // 2. select/radio need at least 2 options, with unique values.
      const needsOptions = (OPTION_FIELD_TYPES as readonly string[]).includes(field.type);
      if (needsOptions) {
        const values = field.options?.map((o) => o.value) ?? [];
        if (values.length < 2) {
          ctx.addIssue({ code: "custom", path: [...path, "options"], message: `"${field.type}" needs at least 2 options` });
        } else if (new Set(values).size !== values.length) {
          ctx.addIssue({ code: "custom", path: [...path, "options"], message: "Option values must be unique" });
        }
      }

      // 3. min must not be greater than max.
      const { min, max } = field.rules ?? {};
      if (min !== undefined && max !== undefined && min > max) {
        ctx.addIssue({ code: "custom", path: [...path, "rules"], message: "rules.min is greater than rules.max" });
      }

      // 4. showIf must point to a field that appears EARLIER (no forward refs, no self, no cycles).
      if (field.showIf) {
        const target = seenFields.get(field.showIf.fieldId);
        if (!target) {
          ctx.addIssue({
            code: "custom",
            path: [...path, "showIf", "fieldId"],
            message: `showIf points to "${field.showIf.fieldId}", which is not an earlier field`,
          });
        } else if (target.options && !target.options.some((o) => o.value === field.showIf!.equals)) {
          // 5. If the target has options, `equals` must be one of them, otherwise the field never shows.
          ctx.addIssue({
            code: "custom",
            path: [...path, "showIf", "equals"],
            message: `"${field.showIf.equals}" is not an option of "${target.id}"`,
          });
        }
      }

      seenFields.set(field.id, field);
    });
  });
});

export type SchemaIssue = { path: string; message: string };

export type ParseResult =
  | { ok: true; schema: z.infer<typeof formSchema> }
  | { ok: false; issues: SchemaIssue[] };

/**
 * Validate unknown data (AI output, localStorage, an imported file).
 * Never throws: the UI shows `issues` with a Retry button instead of crashing.
 */
export function parseFormSchema(data: unknown): ParseResult {
  const result = formSchema.safeParse(data);
  if (result.success) return { ok: true, schema: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}
