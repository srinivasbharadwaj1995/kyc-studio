// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudioView } from "./StudioView";
import { createFlow, getFlow } from "@/lib/storage/flows";
import { initialStudioState, useStudioStore } from "@/lib/store/useStudioStore";
import type { FormSchema } from "@/lib/schema/types";

/** A flow with problems the rules should catch: PAN with no consent, and not masked. */
const risky: FormSchema = {
  name: "Risky KYC",
  purpose: "Verify identity for a savings account",
  steps: [
    {
      id: "basics",
      title: "Basics",
      fields: [
        { id: "full_name", type: "text", label: "Full name", required: true },
        { id: "mobile", type: "mobile", label: "Mobile number", required: true },
      ],
    },
    {
      id: "identity",
      title: "Identity",
      fields: [
        { id: "pan_number", type: "pan", label: "PAN", required: true },
        { id: "city", type: "text", label: "City", required: false },
      ],
    },
  ],
};

let flowId = "";
beforeEach(() => {
  localStorage.clear();
  flowId = createFlow("risky", risky)!.id;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStudioStore.setState(initialStudioState);
});

const issuesList = () => within(screen.getByRole("region", { name: "Compliance & privacy" })).getByRole("list");

describe("StudioView", () => {
  it("loads the saved flow and shows rule issues with risk per step", async () => {
    render(<StudioView id={flowId} />);

    expect(await screen.findByRole("heading", { name: "Risky KYC", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/"PAN" is collected without a consent checkbox/)).toBeInTheDocument();
    expect(screen.getByText(/"PAN" is sensitive but not marked for masking/)).toBeInTheDocument();
    expect(screen.getByText(/2 issues: 1 high, 1 medium/)).toBeInTheDocument();
    expect(screen.getAllByText(/risk$/)).toHaveLength(2);
  });

  it("Fix it applies the change, the issue disappears, Undo brings it back, and it autosaves", async () => {
    const user = userEvent.setup();
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });

    await user.click(screen.getByRole("button", { name: "Fix it: Mark as sensitive" }));
    expect(screen.queryByText(/not marked for masking/)).not.toBeInTheDocument();
    expect(screen.getByText(/Applied: Mark as sensitive/)).toBeInTheDocument();

    // Debounced autosave writes it to storage.
    await waitFor(() => expect(getFlow(flowId)!.schema.steps[1]!.fields[0]!.sensitive).toBe(true));

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText(/not marked for masking/)).toBeInTheDocument();
  });

  it("adding consent fixes the high issue and puts the checkbox before PAN", async () => {
    const user = userEvent.setup();
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });

    await user.click(screen.getByRole("button", { name: "Fix it: Add a consent checkbox before it" }));

    expect(screen.queryByText(/without a consent checkbox/)).not.toBeInTheDocument();
    const step2 = useStudioStore.getState().schema!.steps[1]!.fields.map((f) => f.type);
    expect(step2).toEqual(["consent", "pan", "text"]);
  });

  it("merges AI suggestions and applies their fixes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        issues: [
          {
            id: "ai:0:city:remove_field",
            ruleId: "ai_remove_field",
            severity: "low",
            message: "City isn't needed to verify identity.",
            fieldId: "city",
            stepId: "identity",
            fix: { label: "Remove this field", op: { op: "removeField", fieldId: "city" } },
            source: "ai",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });

    await user.click(screen.getByRole("button", { name: "Run AI review" }));
    expect(await screen.findByText("City isn't needed to verify identity.")).toBeInTheDocument();
    expect(within(issuesList()).getByText("AI suggestion")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fix it: Remove this field" }));
    expect(screen.queryByText("City isn't needed to verify identity.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("City")).not.toBeInTheDocument();
  });

  it("'What's this?' sends only label/type/purpose, never what the customer typed", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ explanation: "Your full name as on your PAN card. It's used to match your ID." }));
    const user = userEvent.setup();
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });

    await user.type(screen.getByLabelText(/^Full name/), "Asha Rao");
    const [explainFullName] = screen.getAllByRole("button", { name: "What's this?" });
    await user.click(explainFullName!);

    expect(await screen.findByText(/as on your PAN card/)).toBeInTheDocument();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body).toEqual({ label: "Full name", type: "text", purpose: risky.purpose });
    expect(JSON.stringify(body)).not.toContain("Asha");
  });

  it("clicking an issue's field jumps to it in the preview", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });

    // PAN is on step 2; the preview is on step 1.
    await user.click(within(issuesList()).getAllByRole("button", { name: "PAN →" })[0]!);
    await act(() => vi.advanceTimersByTimeAsync(10));

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/^PAN/)).toHaveFocus();
    vi.useRealTimers();
  });

  it("shows a helpful message for a flow that doesn't exist", async () => {
    render(<StudioView id="nope" />);
    expect(await screen.findByText("This flow doesn't exist.")).toBeInTheDocument();
  });
});

describe("StudioView: editor", () => {
  async function open() {
    const user = userEvent.setup();
    render(<StudioView id={flowId} />);
    await screen.findByRole("heading", { name: "Risky KYC", level: 1 });
    return user;
  }
  const outline = () => screen.getByRole("navigation", { name: "Form outline" });

  it("selecting a field opens Settings; renaming commits once on Enter and is undoable", async () => {
    const user = await open();
    await user.click(within(outline()).getByRole("button", { name: "Full name" }));
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");

    const label = screen.getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Your full name{Enter}");

    expect(screen.getByLabelText(/^Your full name/)).toBeInTheDocument(); // the preview updated
    expect(useStudioStore.getState().past).toHaveLength(1); // ONE undo step, not one per keystroke

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText(/^Full name/)).toBeInTheDocument();
  });

  it("changing the type to Dropdown adds starter options", async () => {
    const user = await open();
    await user.click(within(outline()).getByRole("button", { name: "City" }));
    await user.selectOptions(screen.getByLabelText("Type"), "Dropdown");

    expect(screen.getByRole("group", { name: "Options" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "City" })).toBeInTheDocument(); // preview now shows a select
  });

  it("adds and deletes fields from the outline", async () => {
    const user = await open();
    await user.click(within(outline()).getAllByRole("button", { name: "+ Add field" })[0]!);
    expect(within(outline()).getByRole("button", { name: "New field" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Delete City" }));
    expect(within(outline()).queryByRole("button", { name: "City" })).not.toBeInTheDocument();
  });

  it("refuses a delete that would break a conditional field, with a reason", async () => {
    const user = await open();
    // Setup: City is shown only when the "I have a GSTIN" checkbox is ticked.
    useStudioStore.getState().apply({
      op: "addField",
      stepId: "basics",
      index: 2,
      field: { id: "has_gst", type: "checkbox", label: "I have a GSTIN", required: false },
    });
    useStudioStore.getState().apply({ op: "updateField", fieldId: "city", changes: { showIf: { fieldId: "has_gst", equals: "true" } } });

    await user.click(await screen.findByRole("button", { name: "Delete I have a GSTIN" }));
    expect(screen.getByText(/Couldn't apply: showIf points to "has_gst"/)).toBeInTheDocument();
    expect(within(outline()).getByRole("button", { name: "I have a GSTIN" })).toBeInTheDocument();
  });

  it("Export shows React code with useForm, and the JSON tab", async () => {
    const user = await open();
    await user.click(screen.getByRole("tab", { name: "Export" }));
    expect(await screen.findByText("RiskyKycForm.tsx")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tabpanel").textContent).toContain("useForm"));

    await user.click(screen.getByRole("button", { name: "Schema JSON" }));
    expect(await screen.findByText("RiskyKyc.schema.json")).toBeInTheDocument();
  });

  it("tabs support arrow-key navigation", async () => {
    const user = await open();
    screen.getByRole("tab", { name: /Checks/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Export" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");
  });
});
