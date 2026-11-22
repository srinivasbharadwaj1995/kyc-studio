import type { FormSchema } from "./types";

/** `base`, or `base_2`, `base_3`… whichever isn't taken by a field or step yet. */
export function uniqueId(schema: FormSchema, base: string): string {
  const taken = new Set(schema.steps.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)]));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}
