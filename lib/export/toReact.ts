import type { Field, FieldType, FormSchema } from "@/lib/schema/types";
import { PATTERNS, UPPERCASE_TYPES } from "@/lib/validators/india";

/**
 * Schema → a standalone React component (React Hook Form + Zod).
 *
 * SAFETY: every piece of user/AI text (labels, messages, options) is written
 * with JSON.stringify, so it becomes a string literal and can never break out
 * into code. A label like `"}); alert(1); ({"` stays a harmless string.
 * Ids are safe by construction (our schema forces snake_case).
 *
 * The exported form mirrors the app's renderer: same Indian regexes (read
 * from india.ts), same messages, same multi-step + showIf behaviour.
 * A test compiles the output with tsc AND renders it, so it can't silently rot.
 */

const str = (s: string) => JSON.stringify(s);
/** One-line text safe inside a // comment. */
const comment = (s: string) => s.replace(/[\r\n\u2028\u2029]+/g, " ");

export function componentName(schema: FormSchema): string {
  const pascal = schema.name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  const base = pascal ? (/^[A-Za-z]/.test(pascal) ? pascal : `Kyc${pascal}`) : "Kyc";
  return base.endsWith("Form") ? base : `${base}Form`;
}

const FORMAT_MESSAGES: Partial<Record<FieldType, string>> = {
  pan: "Enter a valid PAN, e.g. ABCPD1234E",
  gstin: "Enter a valid GSTIN",
  ifsc: "Enter a valid IFSC, e.g. HDFC0001234",
  mobile: "Enter a 10-digit mobile number starting with 6-9",
  pincode: "Enter a valid 6-digit pincode",
  aadhaar_last4: "Enter exactly 4 digits",
  bank_account: "Account number must be 9-18 digits",
  email: "Enter a valid email address",
};

const REGEX_CONST: Partial<Record<FieldType, string>> = {
  pan: "PAN_RE",
  ifsc: "IFSC_RE",
  mobile: "MOBILE_RE",
  pincode: "PINCODE_RE",
  aadhaar_last4: "AADHAAR_LAST4_RE",
  bank_account: "BANK_ACCOUNT_RE",
  email: "EMAIL_RE",
};

function requiredMessage(field: Field): string {
  if (field.type === "consent") return "You must agree to continue";
  if (field.type === "select" || field.type === "radio") return "Please choose an option";
  return `${field.label} is required`;
}

const isChoice = (f: Field) => f.type === "select" || f.type === "radio";
const isBoolean = (f: Field) => f.type === "checkbox" || f.type === "consent";

/** The Zod expression for one field. Conditional fields are optional here; superRefine enforces "required when visible". */
function zodFor(field: Field): string {
  const enforceRequired = field.required && !field.showIf;
  const optional = field.showIf ? ".optional()" : "";

  if (isBoolean(field)) {
    // .optional(): an untouched checkbox may be undefined; "required" means it must be ticked.
    const base = "z.boolean().optional()";
    return enforceRequired ? `${base}.refine((v) => v === true, ${str(requiredMessage(field))})` : base;
  }

  if (isChoice(field)) {
    const values = (field.options ?? []).map((o) => str(o.value)).join(", ");
    if (enforceRequired) return `z.enum([${values}], { error: ${str(requiredMessage(field))} })`;
    // Optional: an untouched select gives "", an untouched radio gives null.
    return `z.enum([${values}, ""]).nullable().optional()`;
  }

  const parts = ["z.string().trim()"];
  if (UPPERCASE_TYPES.has(field.type)) parts.push(".toUpperCase()");
  if (enforceRequired) parts.push(`.min(1, ${str(requiredMessage(field))})`);

  const regex = REGEX_CONST[field.type];
  if (regex) parts.push(`.refine((v) => v === "" || ${regex}.test(v), ${str(FORMAT_MESSAGES[field.type]!)})`);
  if (field.type === "gstin") parts.push(`.refine((v) => v === "" || isValidGstin(v), ${str(FORMAT_MESSAGES.gstin!)})`);

  const { min, max, message } = field.rules ?? {};
  if (field.type === "number") {
    parts.push(`.refine((v) => v === "" || !Number.isNaN(Number(v)), "Enter a valid number")`);
    if (min !== undefined) parts.push(`.refine((v) => v === "" || Number(v) >= ${min}, ${str(message ?? `Must be at least ${min}`)})`);
    if (max !== undefined) parts.push(`.refine((v) => v === "" || Number(v) <= ${max}, ${str(message ?? `Must be at most ${max}`)})`);
  } else if (field.type === "text") {
    if (min !== undefined) parts.push(`.refine((v) => v === "" || v.length >= ${min}, ${str(message ?? `Must be at least ${min} characters`)})`);
    if (max !== undefined) parts.push(`.refine((v) => v === "" || v.length <= ${max}, ${str(message ?? `Must be at most ${max} characters`)})`);
  }
  return parts.join("") + optional;
}

/** JS expression that's true when a conditional field should be visible. */
function visibleWhen(field: Field, all: Field[], valueExpr: (id: string) => string): string {
  const dep = all.find((f) => f.id === field.showIf!.fieldId)!;
  const expected = isBoolean(dep) ? (field.showIf!.equals === "true" ? "true" : "false") : str(field.showIf!.equals);
  return `${valueExpr(dep.id)} === ${expected}`;
}

const HTML_TYPE: Partial<Record<FieldType, string>> = { email: "email", mobile: "tel", date: "date" };
const INPUT_MODE: Partial<Record<FieldType, string>> = {
  mobile: "numeric",
  number: "decimal",
  aadhaar_last4: "numeric",
  pincode: "numeric",
  bank_account: "numeric",
  email: "email",
};
const MAX_LENGTH: Partial<Record<FieldType, number>> = {
  mobile: 10,
  pan: 10,
  gstin: 15,
  ifsc: 11,
  aadhaar_last4: 4,
  pincode: 6,
  bank_account: 18,
};

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function fieldJsx(field: Field): string {
  const id = field.id;
  const key = str(id);
  const required = field.required ? `<span aria-hidden="true"> *</span>` : "";
  const help = field.helpText ? `\n<p id="${id}-help">{${str(field.helpText)}}</p>` : "";
  const describedBy = field.helpText
    ? `aria-describedby={errors[${key}] ? "${id}-help ${id}-error" : "${id}-help"}`
    : `aria-describedby={errors[${key}] ? "${id}-error" : undefined}`;
  const error = `\n{errors[${key}] && <p id="${id}-error" role="alert">{errors[${key}]?.message}</p>}`;
  const invalid = `aria-invalid={errors[${key}] ? true : undefined}`;

  if (isBoolean(field)) {
    return `<div>
  <input id="${id}" type="checkbox" {...register(${key})} ${invalid} ${describedBy} />
  <label htmlFor="${id}">{${str(field.label)}}${required}</label>${help}${error}
</div>`;
  }

  if (field.type === "radio") {
    const options = (field.options ?? [])
      .map((o) => `  <label>\n    <input type="radio" value={${str(o.value)}} {...register(${key})} /> {${str(o.label)}}\n  </label>`)
      .join("\n");
    return `<fieldset ${describedBy}>
  <legend>{${str(field.label)}}${required}</legend>
${options}${help}${error}
</fieldset>`;
  }

  if (field.type === "select") {
    const options = (field.options ?? []).map((o) => `    <option value={${str(o.value)}}>{${str(o.label)}}</option>`).join("\n");
    return `<div>
  <label htmlFor="${id}">{${str(field.label)}}${required}</label>
  <select id="${id}" defaultValue="" {...register(${key})} ${invalid} ${describedBy}>
    <option value="" disabled>
      Select…
    </option>
${options}
  </select>${help}${error}
</div>`;
  }

  const attrs = [
    `id="${id}"`,
    // Sensitive: hidden while typing. (In the studio we use CSS dots; type="password" is the portable choice.)
    `type="${field.sensitive ? "password" : (HTML_TYPE[field.type] ?? "text")}"`,
    INPUT_MODE[field.type] ? `inputMode="${INPUT_MODE[field.type]}"` : "",
    MAX_LENGTH[field.type] ? `maxLength={${MAX_LENGTH[field.type]}}` : "",
    `autoComplete="off"`,
    `{...register(${key})}`,
    invalid,
    describedBy,
  ].filter(Boolean);

  return `<div>
  <label htmlFor="${id}">{${str(field.label)}}${required}</label>
  <input ${attrs.join(" ")} />${help}${error}
</div>`;
}

/** employment_type → employmentType (a variable holding the watched value). */
const watchVar = (id: string) => id.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export function toReactComponent(schema: FormSchema): { fileName: string; code: string } {
  const name = componentName(schema);
  const all = schema.steps.flatMap((s) => s.fields);

  // One useWatch per field that others depend on. useWatch (not watch()) is
  // React Compiler-safe and re-renders only when THAT field changes.
  const watchedIds = [...new Set(all.filter((f) => f.showIf).map((f) => f.showIf!.fieldId))];
  const watchers = watchedIds.map((id) => `  const ${watchVar(id)} = useWatch({ control, name: ${str(id)} });`).join("\n");
  const types = new Set(all.map((f) => f.type));

  // Only include the helpers this form actually uses.
  const helpers: string[] = [];
  const needsPan = types.has("pan") || types.has("gstin");
  for (const [type, constName] of Object.entries(REGEX_CONST) as [FieldType, string][]) {
    if (types.has(type) || (type === "pan" && needsPan)) helpers.push(`const ${constName} = ${PATTERNS[type as keyof typeof PATTERNS].toString()};`);
  }
  if (types.has("gstin")) {
    helpers.push(`const GSTIN_RE = ${PATTERNS.gstin.toString()};
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN = state code + PAN + entity no. + "Z" + a mod-36 check digit. */
function isValidGstin(value: string): boolean {
  const match = GSTIN_RE.exec(value);
  if (!match) return false;
  const state = Number(match[1]);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  if (!PAN_RE.test(match[2]!)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === value[14];
}`);
  }

  const shape = all.map((f) => `    ${str(f.id)}: ${zodFor(f)},`).join("\n");

  const conditional = all.filter((f) => f.showIf);
  const refinements = conditional
    .map((f) => {
      const visible = visibleWhen(f, all, (id) => `data[${str(id)}]`);
      const lines = [`    // ${comment(f.label)}: only shown when ${comment(f.showIf!.fieldId)} is ${comment(f.showIf!.equals)}`];
      if (f.required) {
        const empty = isBoolean(f) ? `!data[${str(f.id)}]` : `!data[${str(f.id)}]`;
        lines.push(
          `    if (${visible} && ${empty}) {`,
          `      ctx.addIssue({ code: "custom", path: [${str(f.id)}], message: ${str(requiredMessage(f))} });`,
          `    }`,
        );
      }
      return lines.join("\n");
    })
    .filter((block) => block.includes("ctx.addIssue"));

  const schemaCode = refinements.length
    ? `const schema = z
  .object({
${shape.replace(/^ {4}/gm, "    ")}
  })
  .superRefine((data, ctx) => {
${refinements.join("\n")}
  });`
    : `const schema = z.object({
${shape.replace(/^ {4}/gm, "  ")}
});`;

  const steps = schema.steps
    .map((s) => `  { title: ${str(s.title)}, fields: [${s.fields.map((f) => str(f.id)).join(", ")}] },`)
    .join("\n");

  const sections = schema.steps
    .map((s, i) => {
      const fields = s.fields
        .map((f) => {
          const jsx = fieldJsx(f);
          if (!f.showIf) return jsx;
          const visible = visibleWhen(f, all, (id) => watchVar(id));
          return `{${visible} && (\n${indent(jsx, 2)}\n)}`;
        })
        .join("\n\n");
      return `<section hidden={step !== ${i}} aria-label={${str(s.title)}}>\n${indent(fields, 2)}\n</section>`;
    })
    .join("\n\n");

  const code = `"use client";

// ${comment(schema.name)}: generated by KYC Studio.
// Purpose: ${comment(schema.purpose)}
// Needs: react, react-hook-form, zod, @hookform/resolvers
// Validation rules are developer hints, not legal or RBI compliance advice.

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

${helpers.join("\n")}

${schemaCode}

// What the inputs hold while typing vs what onSubmit receives after Zod
// (e.g. PAN is uppercased). React Hook Form needs to know both.
type ${name}Input = z.input<typeof schema>;
export type ${name}Values = z.output<typeof schema>;

const STEPS: { title: string; fields: (keyof ${name}Input)[] }[] = [
${steps}
];

export default function ${name}({ onSubmit }: { onSubmit: (values: ${name}Values) => void }) {
  const [step, setStep] = useState(0);
  const {
    register,
    handleSubmit,
    trigger,
    control,
    formState: { errors },
  } = useForm<${name}Input, unknown, ${name}Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    // A hidden conditional field drops its value, so it can't block submit.
    shouldUnregister: true,
  });
${watchers}
  const isLast = step === STEPS.length - 1;

  async function next() {
    // Validate only the current step before moving on.
    if (await trigger(STEPS[step]!.fields)) setStep(step + 1);
  }

  return (
    <form
      noValidate
      onSubmit={
        isLast
          ? handleSubmit(onSubmit)
          : (e) => {
              e.preventDefault();
              void next();
            }
      }
    >
      <h2>{${str(schema.name)}}</h2>
      <p>
        Step {step + 1} of {STEPS.length}: {STEPS[step]!.title}
      </p>
      <progress value={step + 1} max={STEPS.length} aria-label="Form progress" />

${indent(sections, 6)}

      <div>
        <button type="button" onClick={() => setStep(step - 1)} disabled={step === 0}>
          Back
        </button>
        <button type="submit">{isLast ? "Submit" : "Next"}</button>
      </div>
    </form>
  );
}
`;

  return { fileName: `${name}.tsx`, code };
}
