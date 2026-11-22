import type { z } from "zod";
import type { FIELD_TYPES, formSchema } from "./zod";

/**
 * Types are DERIVED from the Zod schema, not written by hand.
 * If we change zod.ts, these update automatically, so the runtime check
 * and the compile-time type can never disagree.
 */
export type FormSchema = z.infer<typeof formSchema>;
export type Step = FormSchema["steps"][number];
export type Field = Step["fields"][number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type FieldOption = NonNullable<Field["options"]>[number];
