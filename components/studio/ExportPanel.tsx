"use client";

import { useEffect, useMemo, useState } from "react";
import { toReactComponent } from "@/lib/export/toReact";
import type { FormSchema } from "@/lib/schema/types";

type Format = "react" | "json";

/**
 * Export tab: the generated React component, or the raw schema JSON.
 * This whole component is lazy-loaded (next/dynamic in StudioView), and the
 * syntax highlighter (Shiki, large) is lazy-loaded again inside it, so the
 * studio's first load doesn't pay for either.
 */
export default function ExportPanel({ schema }: { schema: FormSchema }) {
  const [format, setFormat] = useState<Format>("react");
  const [status, setStatus] = useState("");

  const { fileName, code } = useMemo(() => {
    if (format === "json") {
      const base = toReactComponent(schema).fileName.replace(/Form\.tsx$/, "");
      return { fileName: `${base}.schema.json`, code: JSON.stringify(schema, null, 2) };
    }
    return toReactComponent(schema);
  }, [schema, format]);

  const highlighted = useHighlighted(code, format === "react" ? "tsx" : "json");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Couldn't copy. Select the code and copy it manually.");
    }
  }

  function download() {
    const blob = new Blob([code], { type: format === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${fileName}.`);
  }

  const segment = (value: Format, label: string) => (
    <button
      type="button"
      aria-pressed={format === value}
      onClick={() => {
        setFormat(value);
        setStatus("");
      }}
      className={`px-3 py-1 text-xs font-medium ${
        format === value ? "bg-indigo-600 text-white" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  const button =
    "rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Export format" className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {segment("react", "React + Zod")}
          {segment("json", "Schema JSON")}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copy} className={button}>
            Copy
          </button>
          <button type="button" onClick={download} className={button}>
            Download
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <code>{fileName}</code>
        {format === "react" && " · needs react-hook-form, zod, @hookform/resolvers"}
      </p>
      <p aria-live="polite" className="min-h-4 text-xs text-green-700 dark:text-green-400">
        {status}
      </p>

      <div className="max-h-[128] overflow-auto rounded-lg border border-zinc-200 text-xs dark:border-zinc-800">
        {highlighted ? (
          // Shiki escapes the code itself and returns only <pre>/<span> markup.
          <div className="shiki-wrapper" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <pre className="p-3" aria-label={`${fileName} source`}>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/** Highlighted HTML once Shiki has loaded; null until then (plain text shows meanwhile). */
function useHighlighted(code: string, lang: "tsx" | "json"): string | null {
  const [result, setResult] = useState<{ code: string; html: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false, // emit CSS variables; globals.css picks light or dark
        }),
      )
      .then((html) => {
        if (!cancelled) setResult({ code, html });
      })
      .catch(() => {
        // Highlighting is a nice-to-have: on failure we keep showing plain text.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  // Never show highlighted HTML for OLD code while the new one is being highlighted.
  return result?.code === code ? result.html : null;
}
