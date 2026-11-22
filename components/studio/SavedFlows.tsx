"use client";

import Link from "next/link";
import { runRuleChecks } from "@/lib/checks/rules";
import { deleteFlow, useSavedFlows } from "@/lib/storage/flows";

const timeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 minutes ago", "yesterday"… */
function timeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return timeFormat.format(Math.round(seconds / size), unit);
  return "just now";
}

export function SavedFlows() {
  const flows = useSavedFlows();

  return (
    <section aria-labelledby="saved-heading" className="space-y-3">
      <h2 id="saved-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Saved flows {flows.length > 0 && <span className="font-normal text-zinc-500 dark:text-zinc-400">({flows.length})</span>}
      </h2>

      {flows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:text-zinc-400 dark:border-zinc-700">
          No saved flows yet. Generate one above; it&apos;s saved in this browser automatically.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((flow) => {
            const issues = runRuleChecks(flow.schema);
            const high = issues.filter((i) => i.severity === "high").length;
            const fieldCount = flow.schema.steps.reduce((n, s) => n + s.fields.length, 0);
            return (
              <li
                key={flow.id}
                className="relative rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <Link href={`/studio/${flow.id}`} className="block space-y-1 pr-14 after:absolute after:inset-0">
                  <span className="block font-medium text-zinc-900 dark:text-zinc-50">{flow.schema.name}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {flow.schema.steps.length} steps · {fieldCount} fields · edited {timeAgo(flow.updatedAt)}
                  </span>
                </Link>
                <span
                  className={`mt-3 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                    issues.length === 0
                      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                      : high > 0
                        ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                  }`}
                >
                  {issues.length === 0 ? "No issues" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
                </span>
                {/* z-10 lifts Delete above the card-wide link overlay. */}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete "${flow.schema.name}"? This can't be undone.`)) deleteFlow(flow.id);
                  }}
                  aria-label={`Delete ${flow.schema.name}`}
                  className="absolute top-3 right-3 z-10 rounded px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
