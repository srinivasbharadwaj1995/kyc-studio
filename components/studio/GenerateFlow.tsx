"use client";

import { useRef, useState } from "react";
import { useObject } from "@ai-sdk/react";
import { StreamingOutline } from "./StreamingOutline";
import { useRouter } from "next/navigation";
import { aiFormSchema, parseFormSchema, type SchemaIssue } from "@/lib/schema/zod";
import { createFlow } from "@/lib/storage/flows";

const EXAMPLES = [
  {
    label: "Personal loan KYC",
    prompt:
      "Personal loan KYC: name, DOB, PAN, last 4 of Aadhaar, monthly income, employment type. If self-employed, ask GSTIN. Bank account with IFSC. 3 steps.",
  },
  {
    label: "Savings account",
    prompt: "Savings account opening: name, email, mobile, DOB, address with pincode, PAN, nominee name and relation. 3 steps.",
  },
  {
    label: "Merchant onboarding",
    prompt: "Merchant onboarding: business name, business type, GSTIN, owner name, owner PAN, mobile, settlement bank account with IFSC. 3 steps.",
  },
];

/** The route sends {"error": "..."}; useObject puts the raw body in error.message. */
function readError(error: Error): string {
  try {
    const parsed: unknown = JSON.parse(error.message);
    if (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON: the request never reached our route (offline, server down).
  }
  return "Couldn't reach the server. Check your connection and retry.";
}

export function GenerateFlow() {
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [issues, setIssues] = useState<SchemaIssue[] | null>(null);
  const [stopped, setStopped] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  const router = useRouter();
  // onFinish may be a callback captured BEFORE the lastPrompt state update
  // landed, so it would read a stale prompt. A ref always holds the current one.
  const promptRef = useRef("");

  const { object, submit, isLoading, stop, error } = useObject({
    api: "/api/generate",
    schema: aiFormSchema,
    onFinish: ({ object: finalObject }) => {
      // The gate: nothing is saved or shown unless it passes our full check.
      const result = parseFormSchema(finalObject);
      if (!result.ok) return setIssues(result.issues);

      const flow = createFlow(promptRef.current, result.schema);
      if (!flow) return setSaveFailed(true);
      setOpening(true);
      router.push(`/studio/${flow.id}`);
    },
  });

  function generate(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 10 || isLoading) return;
    setIssues(null);
    setStopped(false);
    setSaveFailed(false);
    setLastPrompt(trimmed);
    promptRef.current = trimmed;
    submit({ prompt: trimmed });
  }

  function stopGenerating() {
    stop();
    setStopped(true);
  }

  const retry = () => generate(lastPrompt);
  // Did anything useful arrive before the stream ended early?
  const hasPartial = Boolean(object?.steps?.length);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {/* Left: the prompt */}
      <section className="space-y-3">
        <label htmlFor="prompt" className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Describe your onboarding flow
        </label>
        <textarea
          id="prompt"
          rows={6}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(prompt);
          }}
          placeholder="e.g. Vehicle loan KYC: name, mobile, PAN, vehicle model, on-road price…"
          className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => setPrompt(example.prompt)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {example.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => generate(prompt)}
            disabled={isLoading || prompt.trim().length < 10}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? "Generating…" : "Generate form"}
          </button>
          {isLoading && (
            <button type="button" onClick={stopGenerating} className="text-sm text-zinc-600 underline dark:text-zinc-400">
              Stop
            </button>
          )}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Ctrl/⌘ + Enter</span>
        </div>
      </section>

      {/* Right: the result */}
      <section className="min-h-80 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        {isLoading ? (
          <StreamingOutline partial={object} />
        ) : stopped ? (
          <div className="space-y-6">
            <Problem title="Generation stopped" detail="Here's what arrived before you stopped it." onRetry={retry} />
            {hasPartial && <StreamingOutline partial={object} incomplete />}
          </div>
        ) : error ? (
          <div className="space-y-6">
            <Problem title="Generation failed" detail={readError(error)} onRetry={lastPrompt ? retry : undefined} />
            {hasPartial && <StreamingOutline partial={object} incomplete />}
          </div>
        ) : issues ? (
          <div className="space-y-6">
            <Problem
              title="The AI's answer didn't pass our checks"
              detail={
                hasPartial
                  ? "It wasn't applied. Below is what arrived, marked incomplete. Retry usually fixes it."
                  : "Nothing was applied. This usually works on a second try."
              }
              issues={issues}
              onRetry={retry}
            />
            {hasPartial && <StreamingOutline partial={object} incomplete />}
          </div>
        ) : saveFailed ? (
          <Problem
            title="Generated, but couldn't save"
            detail="Your browser blocked storage or it's full. Free up space (delete old flows) and retry."
            onRetry={retry}
          />
        ) : opening ? (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Saved. Opening the studio…
          </p>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your flow will stream in here, then open in the studio. Pick an example or describe your own.
          </p>
        )}
      </section>
    </div>
  );
}

function Problem({
  title,
  detail,
  issues,
  onRetry,
}: {
  title: string;
  detail: string;
  issues?: SchemaIssue[];
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="space-y-3">
      <p className="font-medium text-red-700 dark:text-red-400">{title}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{detail}</p>
      {issues && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500 dark:text-zinc-400">
          {issues.slice(0, 5).map((issue) => (
            <li key={issue.path + issue.message}>
              <code>{issue.path || "(root)"}</code>: {issue.message}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Retry
        </button>
      )}
    </div>
  );
}
