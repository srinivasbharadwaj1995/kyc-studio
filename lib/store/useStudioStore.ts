import { create } from "zustand";
import { applyOp, type ApplyResult, type SchemaOp } from "@/lib/schema/ops";
import type { FormSchema } from "@/lib/schema/types";

/**
 * The studio's single source of state: the current schema plus its history.
 *
 * Why Zustand instead of useState? Several far-apart components (renderer,
 * checks panel, editor, export) need the same schema. With useState we'd
 * pass it through many layers of props. Zustand lets each component select
 * just the slice it needs and re-render only when THAT slice changes.
 *
 * History stores whole snapshots, not inverse ops. Ops are still the only way
 * to change the schema; we just remember the result. Snapshots are a few KB
 * each, and "undo = put the previous snapshot back" can't get out of sync.
 */
export const HISTORY_LIMIT = 50;

type StudioState = {
  /** Which saved flow is loaded (null = not tied to a saved flow). */
  flowId: string | null;
  schema: FormSchema | null;
  past: FormSchema[];
  future: FormSchema[];
  /** The field being edited in the settings panel (UI state, not part of history). */
  selectedFieldId: string | null;
  select: (fieldId: string | null) => void;
  /** Replace the schema (e.g. opening a saved flow). Clears history. */
  load: (schema: FormSchema | null, flowId?: string | null) => void;
  /** Apply one op. On success it becomes one undo step; on failure nothing changes. */
  apply: (op: SchemaOp) => ApplyResult;
  undo: () => void;
  redo: () => void;
};

export const initialStudioState = {
  flowId: null,
  schema: null,
  past: [],
  future: [],
  selectedFieldId: null,
} satisfies Pick<StudioState, "flowId" | "schema" | "past" | "future" | "selectedFieldId">;

export const useStudioStore = create<StudioState>()((set, get) => ({
  ...initialStudioState,

  load: (schema, flowId = null) => set({ schema, flowId, past: [], future: [], selectedFieldId: null }),

  select: (selectedFieldId) => set({ selectedFieldId }),

  apply: (op) => {
    const { schema, past } = get();
    if (!schema) return { ok: false, error: "No schema loaded" };

    const result = applyOp(schema, op);
    if (result.ok) {
      set({
        schema: result.schema,
        past: [...past, schema].slice(-HISTORY_LIMIT),
        future: [], // a new change after undo discards the redo branch
      });
    }
    return result;
  },

  undo: () => {
    const { schema, past, future } = get();
    const previous = past.at(-1);
    if (!schema || !previous) return;
    set({ schema: previous, past: past.slice(0, -1), future: [schema, ...future] });
  },

  redo: () => {
    const { schema, past, future } = get();
    const [nextSchema, ...rest] = future;
    if (!schema || !nextSchema) return;
    set({ schema: nextSchema, past: [...past, schema], future: rest });
  },
}));

// Selectors: components use these so they re-render only when the value changes.
export const selectCanUndo = (s: StudioState) => s.past.length > 0;
export const selectCanRedo = (s: StudioState) => s.future.length > 0;
