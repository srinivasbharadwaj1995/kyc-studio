import type { Field } from "@/lib/schema/types";
import { FORMAT_VALIDATORS, UPPERCASE_TYPES } from "@/lib/validators/india";

/** What a form input can hold. Text inputs give strings, checkboxes give booleans. */
export type FieldValue = string | boolean | null | undefined;
export type FormValues = Record<string, FieldValue>;

export function isEmpty(value: FieldValue): boolean {
  return value === undefined || value === null || value === false || (typeof value === "string" && value.trim() === "");
}

function requiredMessage(field: Field): string {
  if (field.type === "consent") return "You must agree to continue";
  if (field.type === "select" || field.type === "radio") return "Please choose an option";
  return `${field.label} is required`;
}

/**
 * Decide whether ONE value is valid for ONE field.
 * Returns `true` if valid, or the error message to show.
 * (That's the contract React Hook Form's `validate` option expects.)
 *
 * It's a plain function with no React, so it's easy to unit test,
 * and the code exporter can reuse the same logic later.
 * Order: required → format (PAN, GSTIN…, chosen by field TYPE) → min/max.
 */
export function validateField(field: Field, value: FieldValue): true | string {
  if (isEmpty(value)) return field.required ? requiredMessage(field) : true;

  const { min, max, message } = field.rules ?? {};

  const formatCheck = FORMAT_VALIDATORS[field.type];
  if (formatCheck && typeof value === "string") {
    const normalized = UPPERCASE_TYPES.has(field.type) ? value.trim().toUpperCase() : value.trim();
    const formatError = formatCheck(normalized);
    // Our format message wins over the schema's custom message: it's more specific.
    if (formatError) return formatError;
  }

  if (field.type === "number") {
    const n = Number(value);
    if (typeof value !== "string" || Number.isNaN(n)) return "Enter a valid number";
    if (min !== undefined && n < min) return message ?? `Must be at least ${min}`;
    if (max !== undefined && n > max) return message ?? `Must be at most ${max}`;
    return true;
  }

  // For text-like fields, min/max mean length.
  if (typeof value === "string") {
    const length = value.trim().length;
    if (min !== undefined && length < min) return message ?? `Must be at least ${min} characters`;
    if (max !== undefined && length > max) return message ?? `Must be at most ${max} characters`;
  }

  return true;
}
