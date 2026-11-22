"use client";

import { useMemo, useRef, useState } from "react";
import { bySeverity, computeStepRisks, runRuleChecks, type CheckIssue, type RiskLevel, type Severity } from "@/lib/checks/rules";
import type { ApplyResult, SchemaOp } from "@/lib/schema/ops";
import type { FormSchema } from "@/lib/schema/types";

type Props = {
  schema: FormSchema;
  onApply: (op: SchemaOp, label: string) => ApplyResult;
  onJumpToField: (fieldId: string) => void;
};

type AiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; issues: CheckIssue[] }
  | { status: "error"; message: string };

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
const RISK_STYLE: Record<RiskLevel, string> = SEVERITY_STYLE;
const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * Rule issues are DERIVED from the schema (useMemo), not stored. So after
 * "Fix it" changes the schema, the fixed issue simply isn't found next render.
 * No "remove this issue" bookkeeping, and it can't get out of sync.
 *
 * AI issues come from a network call, so they ARE stored. We hide ones whose
 * field no longer exists, and ones the user already fixed.
 */
export function ChecksPanel({ schema, onApply, onJumpToField }: Props) {
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  const [appliedAiIds, setAppliedAiIds] = useState<ReadonlySet<string>>(new Set());
  const [fixErrors, setFixErrors] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  const ruleIssues = useMemo(() => runRuleChecks(schema), [schema]);
  const stepRisks = useMemo(() => computeStepRisks(schema), [schema]);

  const fieldLabels = useMemo(
    () => new Map(schema.steps.flatMap((s) => s.fields.map((f) => [f.id, f.label] as const))),
    [schema],
  );

  const aiIssues =
    ai.status === "done"
      ? ai.issues.filter((i) => !appliedAiIds.has(i.id) && (!i.fieldId || fieldLabels.has(i.fieldId)))
      : [];
  const issues = [...ruleIssues, ...aiIssues].sort(bySeverity);

  async function runAiReview() {
    abortRef.current?.abort(); // a new run cancels the previous one
    const controller = new AbortController();
    abortRef.current = controller;
    setAi({ status: "loading" });
    setAppliedAiIds(new Set());
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema }),
        signal: controller.signal,
      });
      const data: { issues?: CheckIssue[]; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.issues)) throw new Error(data.error ?? "The AI review failed. Please retry.");
      setAi({ status: "done", issues: data.issues });
    } catch (e) {
      if (controller.signal.aborted) return;
      setAi({ status: "error", message: e instanceof Error ? e.message : "The AI review failed." });
    }
  }

  function fix(issue: CheckIssue) {
    if (!issue.fix) return;
    const result = onApply(issue.fix.op, issue.fix.label);
    if (result.ok) {
      if (issue.source === "ai") setAppliedAiIds((prev) => new Set(prev).add(issue.id));
      setFixErrors((prev) => {
        const next = { ...prev };
        delete next[issue.id];
        return next;
      });
    } else {
      // e.g. AI suggests removing a field that another field's showIf needs.
      setFixErrors((prev) => ({ ...prev, [issue.id]: result.error }));
    }
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const i of issues) counts[i.severity]++;

  return (
    <div className="space-y-6">
      <section aria-labelledby="issues-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="issues-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Compliance &amp; privacy
          </h2>
          <button
            type="button"
            onClick={runAiReview}
            disabled={ai.status === "loading"}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {ai.status === "loading" ? "AI reviewing…" : ai.status === "done" ? "Re-run AI review" : "Run AI review"}
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
          {issues.length === 0
            ? "No issues found."
            : `${issues.length} issue${issues.length === 1 ? "" : "s"}: ${counts.high} high, ${counts.medium} medium, ${counts.low} low.`}{" "}
          {ai.status === "idle" && "Rule checks run live; the AI review adds deeper suggestions."}
        </p>

        {ai.status === "error" && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {ai.message}
          </p>
        )}

        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.id} className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                {/* Severity shown as TEXT too, never colour alone (accessibility). */}
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[issue.severity]}`}>
                  {SEVERITY_LABEL[issue.severity]}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">{issue.source === "ai" ? "AI suggestion" : "Rule"}</span>
                {issue.fieldId && fieldLabels.has(issue.fieldId) && (
                  <button
                    type="button"
                    onClick={() => onJumpToField(issue.fieldId!)}
                    className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {fieldLabels.get(issue.fieldId)} →
                  </button>
                )}
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{issue.message}</p>
              {issue.fix && (
                <button
                  type="button"
                  onClick={() => fix(issue)}
                  className="rounded-md border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                >
                  Fix it: {issue.fix.label}
                </button>
              )}
              {fixErrors[issue.id] && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  Couldn&apos;t apply: {fixErrors[issue.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="risk-heading" className="space-y-3">
        <h2 id="risk-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Drop-off risk by step
        </h2>
        <ul className="space-y-2">
          {stepRisks.map((risk, i) => {
            const step = schema.steps[i]!;
            return (
              <li key={risk.stepId} className="space-y-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {i + 1}. {step.title} <span className="font-normal text-zinc-500 dark:text-zinc-400">({step.fields.length} fields)</span>
                  </p>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${RISK_STYLE[risk.risk]}`}>
                    {SEVERITY_LABEL[risk.risk]} risk
                  </span>
                </div>
                <ul className="list-disc pl-5 text-xs text-zinc-500 dark:text-zinc-400">
                  {risk.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {risk.fix && (
                  <button
                    type="button"
                    onClick={() => onApply(risk.fix!.op, risk.fix!.label)}
                    className="mt-1 rounded-md border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                  >
                    Fix it: {risk.fix.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">These checks are hints for developers, not legal or RBI compliance advice.</p>
    </div>
  );
}
