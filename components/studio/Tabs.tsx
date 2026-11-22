"use client";

import { useRef, type ReactNode } from "react";

export type Tab<T extends string> = { id: T; label: string; badge?: ReactNode };

/**
 * Accessible tabs (WAI-ARIA "tabs" pattern): role=tablist/tab/tabpanel,
 * arrow keys move between tabs, only the active tab is in the Tab order.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  children,
}: {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  idPrefix: string;
  children: ReactNode;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const jump = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (!delta && jump === null) return;
    e.preventDefault();
    const next = tabs[jump ?? (index + delta + tabs.length) % tabs.length]!;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Studio panels" className="flex border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                selected
                  ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-${active}`} aria-labelledby={`${idPrefix}-tab-${active}`} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
