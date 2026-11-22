"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FormRenderer, type FormRendererHandle } from "@/components/renderer/FormRenderer";
import { ExplainProvider } from "@/components/renderer/ExplainContext";
import { ChecksPanel } from "./ChecksPanel";
import { FieldSettings } from "./FieldSettings";
import { Outline } from "./Outline";
import { Tabs } from "./Tabs";
import { runRuleChecks } from "@/lib/checks/rules";
import type { SchemaOp } from "@/lib/schema/ops";
import type { FormSchema } from "@/lib/schema/types";
import type { FormValues } from "@/lib/renderer/validateField";
import { updateFlowSchema, useSavedFlows } from "@/lib/storage/flows";
import { selectCanRedo, selectCanUndo, useStudioStore } from "@/lib/store/useStudioStore";

// Lazy: the exporter + its highlighter load only when the Export tab is opened.
const ExportPanel = dynamic(() => import("./ExportPanel"), {
  loading: () => <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading export…</p>,
});

// true on the client after hydration, false on the server. Lets us tell
// "still loading from localStorage" apart from "this flow doesn't exist".
const noopSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

const AUTOSAVE_DELAY_MS = 500;
type PanelId = "settings" | "checks" | "export";

export function StudioView({ id }: { id: string }) {
  const hydrated = useHydrated();
  const flow = useSavedFlows().find((f) => f.id === id);

  const schema = useStudioStore((s) => s.schema);
  const loadedFlowId = useStudioStore((s) => s.flowId);
  const selectedFieldId = useStudioStore((s) => s.selectedFieldId);
  const load = useStudioStore((s) => s.load);
  const select = useStudioStore((s) => s.select);
  const apply = useStudioStore((s) => s.apply);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const canUndo = useStudioStore(selectCanUndo);
  const canRedo = useStudioStore(selectCanRedo);

  const rendererRef = useRef<FormRendererHandle>(null);
  const savedSchemaRef = useRef<FormSchema | null>(null);
  const [panel, setPanel] = useState<PanelId>("checks");
  const [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState<FormValues | null>(null);

  // Put the saved flow into the store once per flow id.
  useEffect(() => {
    if (flow && loadedFlowId !== id) {
      savedSchemaRef.current = flow.schema;
      load(flow.schema, id);
    }
  }, [flow, id, loadedFlowId, load]);

  // Autosave, debounced: 10 quick edits = 1 write, 500ms after the last one.
  useEffect(() => {
    if (!schema || loadedFlowId !== id || schema === savedSchemaRef.current) return;
    const timer = setTimeout(() => {
      if (updateFlowSchema(id, schema)) savedSchemaRef.current = schema;
      else setNotice("Couldn't save: browser storage is full or blocked.");
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [schema, id, loadedFlowId]);

  // Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z or Ctrl+Y = redo. Inside an input, leave
  // the browser's own text undo alone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const issueCount = useMemo(() => (schema ? runRuleChecks(schema).length : 0), [schema]);
  const selectedField = schema?.steps.flatMap((s) => s.fields).find((f) => f.id === selectedFieldId) ?? null;

  function applyWithNotice(op: SchemaOp, label: string) {
    const result = apply(op);
    setNotice(result.ok ? `Applied: ${label}. Press Undo to revert.` : `Couldn't apply: ${result.error}`);
    return result;
  }

  function selectField(fieldId: string) {
    select(fieldId);
    setPanel("settings");
    rendererRef.current?.jumpToField(fieldId);
  }

  if (!hydrated || (flow && loadedFlowId !== id)) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading flow…</p>;
  }

  if (!flow || !schema) {
    return (
      <div className="space-y-3">
        <p className="font-medium text-zinc-900 dark:text-zinc-50">This flow doesn&apos;t exist.</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">It may have been deleted, or saved in a different browser.</p>
        <Link href="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Back to all flows
        </Link>
      </div>
    );
  }

  const toolButton =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
  const card = "rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
            ← All flows
          </Link>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{schema.name}</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{schema.purpose}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={undo} disabled={!canUndo} className={toolButton} aria-keyshortcuts="Control+Z">
            Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} className={toolButton} aria-keyshortcuts="Control+Shift+Z">
            Redo
          </button>
          <button type="button" onClick={() => setPanel("export")} className={toolButton}>
            Export
          </button>
        </div>
      </header>

      <p aria-live="polite" className="min-h-5 text-xs text-zinc-600 dark:text-zinc-400">
        {notice}
      </p>

      <div className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_minmax(0,26rem)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className={card}>
          <Outline schema={schema} selectedFieldId={selectedFieldId} onSelect={selectField} onApply={applyWithNotice} />
        </div>

        <section aria-label="Customer preview" className={`${card} space-y-4`}>
          <p className="text-xs font-medium tracking-wide text-zinc-500 dark:text-zinc-400 uppercase">Customer preview</p>
          <ExplainProvider purpose={schema.purpose}>
            <FormRenderer ref={rendererRef} schema={schema} onSubmit={setSubmitted} />
          </ExplainProvider>
          {submitted && (
            <pre className="rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">{JSON.stringify(submitted, null, 2)}</pre>
          )}
        </section>

        <aside className={`${card} lg:col-span-2 xl:col-span-1`}>
          <Tabs<PanelId>
            idPrefix="studio"
            active={panel}
            onChange={setPanel}
            tabs={[
              { id: "settings", label: "Settings" },
              {
                id: "checks",
                label: "Checks",
                badge:
                  issueCount > 0 ? (
                    <span className="rounded-full bg-red-100 px-1.5 text-xs text-red-800 dark:bg-red-950/50 dark:text-red-300">
                      {issueCount}
                    </span>
                  ) : null,
              },
              { id: "export", label: "Export" },
            ]}
          >
            {panel === "settings" &&
              (selectedField ? (
                // key: a different field = fresh settings form (no stale error/inputs)
                <FieldSettings key={selectedField.id} schema={schema} field={selectedField} onApply={applyWithNotice} />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Select a field in the outline to edit it.</p>
              ))}
            {panel === "checks" && (
              <ChecksPanel schema={schema} onApply={applyWithNotice} onJumpToField={(fieldId) => selectFieldFromCheck(fieldId)} />
            )}
            {panel === "export" && <ExportPanel schema={schema} />}
          </Tabs>
        </aside>
      </div>
    </div>
  );

  // From the Checks panel: jump to the field in the preview, but stay on Checks.
  function selectFieldFromCheck(fieldId: string) {
    select(fieldId);
    rendererRef.current?.jumpToField(fieldId);
  }
}
