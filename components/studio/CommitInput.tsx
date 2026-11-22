"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * An input that reports its value only when the user is DONE (blur or Enter),
 * not on every keystroke. Why: each commit becomes a SchemaOp and one undo step.
 * Typing "Full name" letter by letter would otherwise create 9 undo steps.
 *
 * It's "uncontrolled" (defaultValue). The `key` includes the current value, so
 * when the value changes from OUTSIDE (undo, Fix it), React remounts the input
 * with the new value instead of keeping stale text.
 */
type Props = {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onBlur">;

export function CommitInput({ value, onCommit, multiline, id, ...rest }: Props) {
  const commit = (next: string) => {
    if (next !== value) onCommit(next);
  };

  if (multiline) {
    return (
      <textarea
        key={`${id}:${value}`}
        id={id}
        defaultValue={value}
        onBlur={(e) => commit(e.target.value)}
        {...rest}
      />
    );
  }

  return (
    <input
      key={`${id}:${value}`}
      id={id}
      defaultValue={value}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur(); // Enter = done
        if (e.key === "Escape") {
          e.currentTarget.value = value; // Escape = cancel
          e.currentTarget.blur();
        }
      }}
      {...rest}
    />
  );
}
