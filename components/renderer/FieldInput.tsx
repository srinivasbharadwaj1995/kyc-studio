"use client";

import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { Field, FieldType } from "@/lib/schema/types";
import { validateField, type FormValues } from "@/lib/renderer/validateField";
import { isFieldVisible } from "@/lib/renderer/visibility";
import { UPPERCASE_TYPES } from "@/lib/validators/india";
import { useExplain } from "./ExplainContext";

type InputConfig = {
  htmlType: "text" | "email" | "tel" | "date";
  inputMode?: "numeric" | "decimal" | "email" | "tel";
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
};

/**
 * How each text-like field type is drawn. A lookup table instead of a long
 * if/else chain: adding a new type means adding one line here.
 *
 * `number` uses type="text" + inputMode="decimal" on purpose: type="number"
 * accepts "e", and the mouse wheel silently changes the value.
 * Placeholders are REAL valid examples (they pass our own validators).
 */
const INPUT_CONFIG: Partial<Record<FieldType, InputConfig>> = {
  text: { htmlType: "text" },
  email: { htmlType: "email", inputMode: "email", autoComplete: "email" },
  mobile: { htmlType: "tel", inputMode: "numeric", maxLength: 10, placeholder: "9876543210", autoComplete: "tel-national" },
  date: { htmlType: "date" },
  number: { htmlType: "text", inputMode: "decimal" },
  pan: { htmlType: "text", maxLength: 10, placeholder: "ABCPD1234E" },
  gstin: { htmlType: "text", maxLength: 15, placeholder: "27AAPFU0939F1ZV" },
  ifsc: { htmlType: "text", maxLength: 11, placeholder: "HDFC0001234" },
  aadhaar_last4: { htmlType: "text", inputMode: "numeric", maxLength: 4, placeholder: "1234" },
  pincode: { htmlType: "text", inputMode: "numeric", maxLength: 6, placeholder: "560001", autoComplete: "postal-code" },
  bank_account: { htmlType: "text", inputMode: "numeric", maxLength: 18, placeholder: "9-18 digits" },
};

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
  "aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

/**
 * Entry point. Plain fields render straight away; fields with `showIf`
 * go through ConditionalField, which watches the field they depend on.
 */
export function FieldInput({ field }: { field: Field }) {
  return field.showIf ? <ConditionalField field={field} /> : <FieldControl field={field} />;
}

function ConditionalField({ field }: { field: Field }) {
  // useWatch re-renders ONLY this component when the watched field changes,
  // not the whole form. That matters once forms get big.
  const watched = useWatch<FormValues>({ name: field.showIf!.fieldId });
  const visible = isFieldVisible(field, { [field.showIf!.fieldId]: watched });
  return visible ? <FieldControl field={field} /> : null;
}

function FieldControl({ field }: { field: Field }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<FormValues>();
  const [revealed, setRevealed] = useState(false);

  const config = INPUT_CONFIG[field.type];
  const uppercase = UPPERCASE_TYPES.has(field.type);
  const masked = Boolean(field.sensitive) && !revealed;
  const error = errors[field.id]?.message;

  // Ids that link the input to its help text and error, so screen readers read them out.
  const inputId = `field-${field.id}`;
  const helpId = field.helpText ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const explain = useExplain(field, `${inputId}-explain`);

  const registration = register(field.id, {
    validate: (value) => validateField(field, value),
    // PAN/GSTIN/IFSC are stored uppercase and trimmed, whatever the user types.
    setValueAs: uppercase ? (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v) : undefined,
    // A conditional field that gets hidden drops its value and errors,
    // so a hidden GSTIN can't block the submit.
    shouldUnregister: Boolean(field.showIf),
  });

  const a11y = {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };

  const requiredMark = field.required ? (
    <span aria-hidden="true" className="ml-0.5 text-red-600">
      *
    </span>
  ) : null;

  const help = field.helpText ? (
    <p id={helpId} className="text-xs text-zinc-500 dark:text-zinc-400">
      {field.helpText}
    </p>
  ) : null;

  const errorText = error ? (
    <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
      {error}
    </p>
  ) : null;

  // Checkbox and consent: the label sits beside the box.
  if (field.type === "checkbox" || field.type === "consent") {
    return (
      <div data-field-id={field.id} className="space-y-1 rounded-md transition-shadow">
        <div className="flex items-start">
          <label htmlFor={inputId} className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input id={inputId} type="checkbox" className="mt-0.5 size-4 accent-indigo-600" {...registration} {...a11y} />
            <span>
              {field.label}
              {requiredMark}
            </span>
          </label>
          {explain.button}
        </div>
        {explain.panel}
        {help}
        {errorText}
      </div>
    );
  }

  // Radio: a group of options, so it needs <fieldset> + <legend> instead of one <label>.
  if (field.type === "radio") {
    return (
      <fieldset data-field-id={field.id} className="space-y-1 rounded-md transition-shadow" aria-describedby={describedBy}>
        <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {field.label}
          {requiredMark}
          {explain.button}
        </legend>
        {explain.panel}
        <div className="flex flex-wrap gap-4 pt-1">
          {field.options?.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
              <input type="radio" value={option.value} className="size-4 accent-indigo-600" {...registration} />
              {option.label}
            </label>
          ))}
        </div>
        {help}
        {errorText}
      </fieldset>
    );
  }

  return (
    <div data-field-id={field.id} className="space-y-1 rounded-md transition-shadow">
      <div className="flex items-baseline">
        <label htmlFor={inputId} className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {field.label}
          {requiredMark}
        </label>
        {explain.button}
      </div>
      {explain.panel}

      {field.type === "select" ? (
        <select id={inputId} defaultValue="" className={inputClass} {...registration} {...a11y}>
          <option value="" disabled>
            Select…
          </option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="relative">
          <input
            id={inputId}
            type={config?.htmlType ?? "text"}
            inputMode={config?.inputMode}
            maxLength={config?.maxLength}
            placeholder={config?.placeholder}
            autoComplete={field.sensitive ? "off" : (config?.autoComplete ?? "off")}
            spellCheck={false}
            // Masking: CSS dots instead of type="password", so browsers don't
            // offer to "save this password" for a PAN. It guards against
            // shoulder-surfing in the preview; it is not encryption.
            className={[
              inputClass,
              uppercase ? "uppercase" : "",
              field.sensitive ? "pr-16" : "",
              masked ? "[-webkit-text-security:disc]" : "",
            ].join(" ")}
            data-masked={masked || undefined}
            {...registration}
            {...a11y}
          />
          {field.sensitive && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-pressed={revealed}
              aria-controls={inputId}
              aria-label={revealed ? `Hide ${field.label}` : `Show ${field.label}`}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
            >
              {revealed ? "Hide" : "Show"}
            </button>
          )}
        </div>
      )}
      {help}
      {errorText}
    </div>
  );
}
