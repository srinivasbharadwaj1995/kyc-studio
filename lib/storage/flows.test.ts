// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFlow, deleteFlow, getFlow, listFlows, STORAGE_KEY, updateFlowSchema } from "./flows";
import { samplePersonalLoan as sample } from "@/lib/schema/sample";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("flow storage", () => {
  it("creates, reads, updates and deletes a flow", () => {
    const flow = createFlow("personal loan", sample, 1000)!;
    expect(getFlow(flow.id)).toMatchObject({ prompt: "personal loan", createdAt: 1000 });

    const renamed = { ...sample, name: "Renamed" };
    expect(updateFlowSchema(flow.id, renamed, 2000)).toBe(true);
    expect(getFlow(flow.id)).toMatchObject({ schema: { name: "Renamed" }, updatedAt: 2000 });

    expect(deleteFlow(flow.id)).toBe(true);
    expect(listFlows()).toEqual([]);
  });

  it("lists the most recently edited first", () => {
    const a = createFlow("a", sample, 1000)!;
    createFlow("b", sample, 2000);
    updateFlowSchema(a.id, sample, 3000);
    expect(listFlows().map((f) => f.prompt)).toEqual(["a", "b"]);
  });

  it("survives corrupted storage instead of crashing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(listFlows()).toEqual([]);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    expect(listFlows()).toEqual([]);
  });

  it("skips individual invalid flows but keeps the valid ones", () => {
    const good = { id: "good", prompt: "", schema: sample, createdAt: 1, updatedAt: 1 };
    const tampered = { id: "bad", prompt: "", schema: { ...sample, steps: "hacked" }, createdAt: 1, updatedAt: 1 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([good, tampered, null, 42]));
    expect(listFlows().map((f) => f.id)).toEqual(["good"]);
  });

  it("reports failure when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    expect(createFlow("x", sample)).toBeNull();
  });

  it("returns false when updating a flow that doesn't exist", () => {
    expect(updateFlowSchema("ghost", sample)).toBe(false);
  });
});
