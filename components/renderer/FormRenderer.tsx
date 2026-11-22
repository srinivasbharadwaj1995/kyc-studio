"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { FormSchema } from "@/lib/schema/types";
import type { FormValues } from "@/lib/renderer/validateField";
import { isFieldVisible } from "@/lib/renderer/visibility";
import { FieldInput } from "./FieldInput";

/** Actions a parent can trigger, e.g. the Checks panel's "go to this field". */
export type FormRendererHandle = { jumpToField: (fieldId: string) => void };

type Props = {
  schema: FormSchema;
  onSubmit?: (values: FormValues) => void;
  ref?: Ref<FormRendererHandle>;
};

/**
 * Turns a FormSchema (JSON) into a working multi-step form.
 * It knows nothing about AI or KYC: give it any valid schema and it draws it.
 */
export function FormRenderer({ schema, onSubmit, ref }: Props) {
  // "onTouched": don't shout errors while the user is still typing the first time.
  const methods = useForm<FormValues>({ mode: "onTouched" });
  const [rawStepIndex, setStepIndex] = useState(0);

  const steps = schema.steps;
  // The schema can change under us (Fix it, undo): if steps were removed,
  // stay on the last step that still exists instead of crashing.
  const stepIndex = Math.min(rawStepIndex, steps.length - 1);
  const step = steps[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);

  // When the step changes, move keyboard/screen-reader focus to the new step's heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const hasNavigated = useRef(false);
  useEffect(() => {
    if (hasNavigated.current) headingRef.current?.focus();
  }, [stepIndex]);

  // React 19: `ref` is a normal prop; useImperativeHandle decides what it exposes.
  useImperativeHandle(
    ref,
    () => ({
      jumpToField(fieldId) {
        const target = steps.findIndex((s) => s.fields.some((f) => f.id === fieldId));
        if (target === -1) return;
        hasNavigated.current = false; // focus the FIELD, not the step heading
        setStepIndex(target);
        // Wait one tick so the step is visible before scrolling and focusing.
        setTimeout(() => {
          const el = formRef.current?.querySelector<HTMLElement>(`[data-field-id="${fieldId}"]`);
          if (!el) return; // e.g. a conditional field that's currently hidden
          el.scrollIntoView?.({ block: "center", behavior: "smooth" });
          el.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
          el.classList.add("ring-2", "ring-amber-400", "ring-offset-4");
          setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-4"), 1600);
        }, 0);
      },
    }),
    [steps],
  );

  async function goNext() {
    // Validate ONLY the current step's VISIBLE fields before moving on.
    // A hidden conditional field (e.g. GSTIN for salaried users) must not block Next.
    const values = methods.getValues();
    const visibleIds = step.fields.filter((f) => isFieldVisible(f, values)).map((f) => f.id);
    const valid = await methods.trigger(visibleIds);
    if (valid) {
      hasNavigated.current = true;
      setStepIndex(stepIndex + 1);
    }
  }

  function goBack() {
    hasNavigated.current = true;
    setStepIndex(stepIndex - 1);
  }

  const submit = methods.handleSubmit((values) => onSubmit?.(values));

  return (
    <FormProvider {...methods}>
      <form
        ref={formRef}
        noValidate // we show our own errors, not the browser's popups
        onSubmit={(e) => {
          if (isLast) return submit(e);
          e.preventDefault(); // pressing Enter on a middle step = Next
          void goNext();
        }}
        className="space-y-6"
      >
        <header className="space-y-3">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{schema.name}</h2>
          <div>
            <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
              Step {stepIndex + 1} of {steps.length}
            </p>
            <div
              role="progressbar"
              aria-label="Form progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            >
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </header>

        {/*
          All steps stay mounted; only the current one is visible.
          So values typed in step 1 survive going to step 3 and back,
          and the final submit still validates every field.
        */}
        {steps.map((s, i) => (
          <section key={s.id} hidden={i !== stepIndex} aria-labelledby={`step-${s.id}`} className="space-y-4">
            <h3
              id={`step-${s.id}`}
              ref={i === stepIndex ? headingRef : undefined}
              tabIndex={-1}
              className="text-base font-medium text-zinc-800 outline-none dark:text-zinc-200"
            >
              {s.title}
            </h3>
            {s.fields.map((field) => (
              <FieldInput key={field.id} field={field} />
            ))}
          </section>
        ))}

        <div className="flex justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={goBack}
            disabled={isFirst}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            Back
          </button>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none"
          >
            {isLast ? "Submit" : "Next"}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
