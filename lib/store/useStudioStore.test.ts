import { beforeEach, describe, expect, it } from "vitest";
import { HISTORY_LIMIT, initialStudioState, selectCanRedo, selectCanUndo, useStudioStore } from "./useStudioStore";
import { samplePersonalLoan as sample } from "@/lib/schema/sample";

// Zustand stores are plain objects outside React, so we can test them directly.
const store = () => useStudioStore.getState();
const label = () => store().schema?.steps[0]?.fields[0]?.label;
const rename = (to: string) => store().apply({ op: "updateField", fieldId: "full_name", changes: { label: to } });

beforeEach(() => useStudioStore.setState(initialStudioState));

describe("useStudioStore", () => {
  it("starts empty, and apply without a schema fails safely", () => {
    expect(store().schema).toBeNull();
    expect(rename("X")).toEqual({ ok: false, error: "No schema loaded" });
  });

  it("undo and redo walk through history", () => {
    store().load(sample);
    rename("Name");
    rename("Your name");
    expect(label()).toBe("Your name");

    store().undo();
    expect(label()).toBe("Name");
    store().undo();
    expect(label()).toBe("Full name");
    expect(selectCanUndo(store())).toBe(false);

    store().redo();
    expect(label()).toBe("Name");
    expect(selectCanRedo(store())).toBe(true);
  });

  it("a new change after undo discards the redo branch", () => {
    store().load(sample);
    rename("A");
    store().undo();
    rename("B");
    expect(selectCanRedo(store())).toBe(false);
    expect(label()).toBe("B");
  });

  it("a rejected op changes nothing and adds no history", () => {
    store().load(sample);
    const result = store().apply({ op: "removeField", fieldId: "employment_type" });
    expect(result.ok).toBe(false);
    expect(store().schema).toEqual(sample);
    expect(selectCanUndo(store())).toBe(false);
  });

  it("load resets history", () => {
    store().load(sample);
    rename("A");
    store().load(sample);
    expect(selectCanUndo(store())).toBe(false);
  });

  it(`keeps at most ${HISTORY_LIMIT} undo steps`, () => {
    store().load(sample);
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) rename(`Name ${i}`);
    expect(store().past).toHaveLength(HISTORY_LIMIT);
  });
});
