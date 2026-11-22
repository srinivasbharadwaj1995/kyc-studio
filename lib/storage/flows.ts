import { useSyncExternalStore } from "react";
import { parseFormSchema } from "@/lib/schema/zod";
import type { FormSchema } from "@/lib/schema/types";

/**
 * Saved flows live in localStorage. No backend needed for a portfolio demo.
 *
 * localStorage is UNTRUSTED input, just like AI output: the user can edit it in
 * DevTools, an older app version may have saved an older shape, or another tab
 * may write half-way. So every flow read back goes through parseFormSchema again,
 * and anything invalid is skipped instead of crashing the dashboard.
 */
export type SavedFlow = {
  id: string;
  prompt: string;
  schema: FormSchema;
  createdAt: number;
  updatedAt: number;
};

// Versioned key: if the saved shape ever changes, bump to v2 and migrate.
export const STORAGE_KEY = "kyc-studio:flows:v1";

/** Tell same-tab listeners that flows changed (the native "storage" event only fires in OTHER tabs). */
const CHANGE_EVENT = "kyc-studio:flows-changed";

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode, blocked storage, or running on the server
  }
}

function parseFlows(raw: string | null): SavedFlow[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const flows: SavedFlow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const { id, prompt, schema, createdAt, updatedAt } = item as Record<string, unknown>;
    const parsed = parseFormSchema(schema);
    if (typeof id !== "string" || !parsed.ok) continue; // skip corrupt entries, keep the rest
    flows.push({
      id,
      prompt: typeof prompt === "string" ? prompt : "",
      schema: parsed.schema,
      createdAt: typeof createdAt === "number" ? createdAt : 0,
      updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
    });
  }
  return flows.sort((a, b) => b.updatedAt - a.updatedAt); // most recently edited first
}

function writeFlows(flows: SavedFlow[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false; // quota exceeded or storage blocked: the caller shows a message
  }
}

export function listFlows(): SavedFlow[] {
  return parseFlows(readRaw());
}

export function getFlow(id: string): SavedFlow | null {
  return listFlows().find((f) => f.id === id) ?? null;
}

export function createFlow(prompt: string, schema: FormSchema, now = Date.now()): SavedFlow | null {
  const flow: SavedFlow = { id: crypto.randomUUID(), prompt, schema, createdAt: now, updatedAt: now };
  return writeFlows([flow, ...listFlows()]) ? flow : null;
}

export function updateFlowSchema(id: string, schema: FormSchema, now = Date.now()): boolean {
  const flows = listFlows();
  const flow = flows.find((f) => f.id === id);
  if (!flow) return false;
  flow.schema = schema;
  flow.updatedAt = now;
  return writeFlows(flows);
}

export function deleteFlow(id: string): boolean {
  return writeFlows(listFlows().filter((f) => f.id !== id));
}

// ---- React hook -------------------------------------------------------------

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

// useSyncExternalStore needs the SAME array back while nothing changed,
// or React re-renders forever. So we cache by the raw string.
let cachedRaw: string | null | undefined;
let cachedFlows: SavedFlow[] = [];
function getSnapshot(): SavedFlow[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedFlows = parseFlows(raw);
  }
  return cachedFlows;
}

const EMPTY: SavedFlow[] = [];
const getServerSnapshot = () => EMPTY; // the server has no localStorage

/**
 * Live list of saved flows. Re-renders when flows change in this tab or another.
 * useSyncExternalStore is React's official way to read an outside store without
 * hydration mismatches: the server renders [] and the client fills in after.
 */
export function useSavedFlows(): SavedFlow[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
