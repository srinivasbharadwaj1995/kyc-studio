"use client";

import { createContext, useContext, useState } from "react";
import type { Field } from "@/lib/schema/types";

/**
 * "Explain this field" is OPTIONAL for the renderer. If a parent wraps the form
 * in <ExplainProvider>, each field gets a "What's this?" button; without it,
 * the renderer stays a plain form (e.g. in tests, or in exported code).
 * That keeps FormRenderer free of any AI or network code.
 */
type ExplainContextValue = { purpose: string };
const ExplainContext = createContext<ExplainContextValue | null>(null);

export function ExplainProvider({ purpose, children }: { purpose: string; children: React.ReactNode }) {
  return <ExplainContext.Provider value={{ purpose }}>{children}</ExplainContext.Provider>;
}

// Client-side cache too: re-opening the same field never hits the network.
const answers = new Map<string, string>();

async function fetchExplanation(field: Field, purpose: string): Promise<string> {
  const key = `${field.type}|${field.label}|${purpose}`;
  const hit = answers.get(key);
  if (hit) return hit;

  const res = await fetch("/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // ONLY label, type and purpose. Never the value the customer typed.
    body: JSON.stringify({ label: field.label, type: field.type, purpose }),
  });
  const data: unknown = await res.json().catch(() => null);
  const ok = res.ok && data && typeof data === "object" && "explanation" in data && typeof data.explanation === "string";
  if (!ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : null;
    throw new Error(message ?? "Couldn't load an explanation. Try again.");
  }
  answers.set(key, data.explanation as string);
  return data.explanation as string;
}

type State = { status: "closed" } | { status: "loading" } | { status: "open"; text: string } | { status: "error"; text: string };

/** The "What's this?" toggle plus its answer panel. Renders nothing without a provider. */
export function useExplain(field: Field, panelId: string) {
  const context = useContext(ExplainContext);
  const [state, setState] = useState<State>({ status: "closed" });

  if (!context) return { button: null, panel: null };

  const expanded = state.status !== "closed";

  async function toggle() {
    if (expanded) return setState({ status: "closed" });
    setState({ status: "loading" });
    try {
      setState({ status: "open", text: await fetchExplanation(field, context!.purpose) });
    } catch (e) {
      setState({ status: "error", text: e instanceof Error ? e.message : "Something went wrong" });
    }
  }

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      className="ml-2 text-xs font-normal text-indigo-600 hover:underline dark:text-indigo-400"
    >
      What&apos;s this?
    </button>
  );

  const panel = expanded ? (
    <div
      id={panelId}
      role="status"
      className={`rounded-md p-2 text-xs ${
        state.status === "error"
          ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"
      }`}
    >
      {state.status === "loading" ? "Explaining…" : state.status === "open" || state.status === "error" ? state.text : null}
    </div>
  ) : null;

  return { button, panel };
}
