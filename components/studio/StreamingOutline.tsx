import type { DeepPartial } from "ai";
import type { FormSchema } from "@/lib/schema/types";

/**
 * While Gemini streams, the JSON is incomplete: a field may have a label but
 * no type yet. That's not a valid schema, so we can't hand it to FormRenderer.
 * Instead we show a read-only outline that fills in live, and skip anything
 * that hasn't arrived yet. The strict Zod check runs only when streaming ends.
 *
 * `incomplete`: the stream ended early (Stop pressed, connection cut, or the
 * final answer failed our checks). We keep showing what DID arrive, labelled
 * "Incomplete", instead of throwing it away.
 */
export function StreamingOutline({
  partial,
  incomplete = false,
}: {
  partial: DeepPartial<FormSchema> | undefined;
  incomplete?: boolean;
}) {
  const steps = partial?.steps ?? [];

  return (
    <div aria-live="polite" aria-busy={!incomplete} className="space-y-4">
      <p className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {partial?.name ??
          (incomplete ? "Untitled flow" : <span className="inline-block h-5 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />)}
        {incomplete && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Incomplete
          </span>
        )}
      </p>

      {steps.length === 0 && !incomplete && <SkeletonRows />}

      {steps.map((step, s) =>
        step?.title ? (
          <div key={s} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              Step {s + 1}: {step.title}
            </p>
            <ul className="space-y-1">
              {step.fields?.map((field, f) =>
                field?.label ? (
                  <li key={f} className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                    <span>{field.label}</span>
                    {field.type && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">{field.type}</span>
                    )}
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      ))}
    </div>
  );
}
