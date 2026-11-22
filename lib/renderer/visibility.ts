import type { Field } from "@/lib/schema/types";
import type { FormValues } from "./validateField";

/**
 * Should this field be shown, given the current form values?
 *
 * showIf.equals is always a string, but a checkbox value is a boolean,
 * so we compare as strings: true → "true".
 *
 * Chains work automatically: if A is hidden, its value is removed, so a field
 * B that depends on A also hides.
 */
export function isFieldVisible(field: Field, values: FormValues): boolean {
  if (!field.showIf) return true;
  const value = values[field.showIf.fieldId];
  return String(value ?? "") === field.showIf.equals;
}
