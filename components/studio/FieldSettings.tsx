"use client";

import { useState } from "react";
import { CommitInput } from "./CommitInput";
import type { ApplyResult, SchemaOp } from "@/lib/schema/ops";
import type { Field, FieldOption, FieldType, FormSchema } from "@/lib/schema/types";
import { FIELD_TYPES, OPTION_FIELD_TYPES } from "@/lib/schema/zod";

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  email: "Email",
  mobile: "Mobile (India)",
  date: "Date",
  number: "Number",
  select: "Dropdown",
  radio: "Radio buttons",
  checkbox: "Checkbox",
  pan: "PAN",
  gstin: "GSTIN",
  ifsc: "IFSC",
  aadhaar_last4: "Aadhaar (last 4)",
  pincode: "Pincode",
  bank_account: "Bank account",
  consent: "Consent checkbox",
};

const isOptionType = (t: FieldType) => (OPTION_FIELD_TYPES as readonly string[]).includes(t);
const LENGTH_TYPES: ReadonlySet<FieldType> = new Set(["text", "number"]);

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const labelClass = "block text-xs font-medium text-zinc-600 dark:text-zinc-400";

type Props = {
  schema: FormSchema;
  field: Field;
  onApply: (op: SchemaOp, label: string) => ApplyResult;
};

/** snake_case from any label: "Monthly income (₹)" → "monthly_income". */
export function toSnakeCase(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(s) ? s.slice(0, 40) : `option_${s}`.slice(0, 40);
}

export function FieldSettings({ schema, field, onApply }: Props) {
  const [error, setError] = useState("");
  const id = (name: string) => `settings-${field.id}-${name}`;

  function update(changes: Partial<Omit<Field, "id">>, label: string) {
    const result = onApply({ op: "updateField", fieldId: field.id, changes }, label);
    setError(result.ok ? "" : result.error);
  }

  function changeType(type: FieldType) {
    const changes: Partial<Omit<Field, "id">> = { type };
    // Dropdown/radio need options: start with two placeholders. Other types don't use options.
    if (isOptionType(type) && !field.options?.length) {
      changes.options = [
        { label: "Option 1", value: "option_1" },
        { label: "Option 2", value: "option_2" },
      ];
    } else if (!isOptionType(type)) {
      changes.options = undefined;
    }
    if (!LENGTH_TYPES.has(type)) changes.rules = undefined; // min/max only mean something for text/number
    update(changes, `Change type to ${FIELD_TYPE_LABELS[type]}`);
  }

  function setOptions(options: FieldOption[], label: string) {
    update({ options }, label);
  }

  function setRule(key: "min" | "max" | "message", raw: string) {
    const rules = { ...field.rules };
    if (raw.trim() === "") delete rules[key];
    else if (key === "message") rules.message = raw;
    else if (Number.isFinite(Number(raw))) rules[key] = Number(raw);
    else return setError(`${key} must be a number`);
    update({ rules: Object.keys(rules).length ? rules : undefined }, `Update ${key}`);
  }

  // showIf can only depend on an EARLIER field with known values (choices or a checkbox).
  const allFields = schema.steps.flatMap((s) => s.fields);
  const earlier = allFields.slice(0, allFields.findIndex((f) => f.id === field.id));
  const dependable = earlier.filter((f) => f.options?.length || f.type === "checkbox" || f.type === "consent");
  const dependsOn = allFields.find((f) => f.id === field.showIf?.fieldId);
  const valuesOf = (f: Field) => f.options ?? [{ label: "Ticked", value: "true" }];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Field settings</h2>
        <code className="text-xs text-zinc-500 dark:text-zinc-400" title="Ids can't change: other fields may depend on them">
          {field.id}
        </code>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor={id("label")} className={labelClass}>
          Label
        </label>
        <CommitInput id={id("label")} value={field.label} onCommit={(label) => update({ label }, "Rename field")} className={inputClass} />
      </div>

      <div className="space-y-1">
        <label htmlFor={id("type")} className={labelClass}>
          Type
        </label>
        <select id={id("type")} value={field.type} onChange={(e) => changeType(e.target.value as FieldType)} className={inputClass}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={id("help")} className={labelClass}>
          Help text <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
        </label>
        <CommitInput
          id={id("help")}
          multiline
          rows={2}
          value={field.helpText ?? ""}
          onCommit={(text) => update({ helpText: text.trim() || undefined }, "Update help text")}
          className={inputClass}
        />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => update({ required: e.target.checked }, e.target.checked ? "Make required" : "Make optional")}
            className="size-4 accent-indigo-600"
          />
          Required
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={Boolean(field.sensitive)}
            onChange={(e) => update({ sensitive: e.target.checked || undefined }, e.target.checked ? "Mark as sensitive" : "Unmark sensitive")}
            className="size-4 accent-indigo-600"
          />
          Sensitive (mask)
        </label>
      </div>

      {isOptionType(field.type) && (
        <fieldset className="space-y-2">
          <legend className={labelClass}>Options</legend>
          {(field.options ?? []).map((option, i) => (
            <div key={`${option.value}-${i}`} className="flex items-center gap-2">
              <CommitInput
                id={id(`option-${i}`)}
                aria-label={`Option ${i + 1} label`}
                value={option.label}
                onCommit={(label) => {
                  const options = [...(field.options ?? [])];
                  // The value follows the label, so exported code stays readable.
                  options[i] = { label, value: toSnakeCase(label) || option.value };
                  setOptions(options, "Rename option");
                }}
                className={inputClass}
              />
              <button
                type="button"
                aria-label={`Remove option ${option.label}`}
                onClick={() => setOptions((field.options ?? []).filter((_, j) => j !== i), "Remove option")}
                className="rounded px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const n = (field.options?.length ?? 0) + 1;
              setOptions([...(field.options ?? []), { label: `Option ${n}`, value: `option_${n}` }], "Add option");
            }}
            className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
          >
            + Add option
          </button>
        </fieldset>
      )}

      {LENGTH_TYPES.has(field.type) && (
        <fieldset className="space-y-2">
          <legend className={labelClass}>{field.type === "number" ? "Value limits" : "Length limits"}</legend>
          <div className="grid grid-cols-2 gap-2">
            <CommitInput
              id={id("min")}
              aria-label="Minimum"
              placeholder="Min"
              inputMode="numeric"
              value={field.rules?.min?.toString() ?? ""}
              onCommit={(v) => setRule("min", v)}
              className={inputClass}
            />
            <CommitInput
              id={id("max")}
              aria-label="Maximum"
              placeholder="Max"
              inputMode="numeric"
              value={field.rules?.max?.toString() ?? ""}
              onCommit={(v) => setRule("max", v)}
              className={inputClass}
            />
          </div>
          <CommitInput
            id={id("message")}
            aria-label="Custom error message"
            placeholder="Custom error message (optional)"
            value={field.rules?.message ?? ""}
            onCommit={(v) => setRule("message", v)}
            className={inputClass}
          />
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className={labelClass}>Show this field only if…</legend>
        <select
          aria-label="Depends on field"
          value={field.showIf?.fieldId ?? ""}
          onChange={(e) => {
            const target = dependable.find((f) => f.id === e.target.value);
            update(
              { showIf: target ? { fieldId: target.id, equals: valuesOf(target)[0]!.value } : undefined },
              target ? `Show only if ${target.label}` : "Always show",
            );
          }}
          className={inputClass}
        >
          <option value="">Always show</option>
          {dependable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {field.showIf && dependsOn && (
          <select
            aria-label="Equals"
            value={field.showIf.equals}
            onChange={(e) => update({ showIf: { fieldId: dependsOn.id, equals: e.target.value } }, "Change condition")}
            className={inputClass}
          >
            {valuesOf(dependsOn).map((o) => (
              <option key={o.value} value={o.value}>
                is {o.label}
              </option>
            ))}
          </select>
        )}
        {dependable.length === 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Add a dropdown, radio or checkbox before this field to make it conditional.</p>
        )}
      </fieldset>
    </div>
  );
}
