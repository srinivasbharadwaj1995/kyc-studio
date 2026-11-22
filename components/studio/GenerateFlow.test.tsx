// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenerateFlow } from "./GenerateFlow";
import geminiPersonalLoan from "@/lib/schema/fixtures/gemini-personal-loan.json";
import { listFlows } from "@/lib/storage/flows";

// Next's router doesn't exist outside the Next runtime, so we fake it.
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/**
 * We never call Gemini in tests: it's slow, costs quota and gives different
 * answers each time. Instead we replace `fetch` with a fake that streams a
 * recorded real Gemini answer back in small chunks, like the real route does.
 */
function mockStream(text: string, chunkSize = 40) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < text.length; i += chunkSize) controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)));
      controller.close();
    },
  });
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 200 }));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

async function generateWith(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Personal loan KYC" }));
  await user.click(screen.getByRole("button", { name: "Generate form" }));
}

describe("GenerateFlow", () => {
  it("saves a valid AI answer and opens it in the studio", async () => {
    const fetchMock = mockStream(JSON.stringify(geminiPersonalLoan));
    const user = userEvent.setup();
    render(<GenerateFlow />);

    await generateWith(user);

    expect(await screen.findByText("Saved. Opening the studio…")).toBeInTheDocument();
    // The prompt went to OUR route, never directly to Google.
    expect(fetchMock).toHaveBeenCalledWith("/api/generate", expect.anything());

    const [saved] = listFlows();
    expect(saved).toMatchObject({ schema: { name: "Personal Loan KYC" }, prompt: expect.stringMatching(/^Personal loan KYC/) });
    expect(push).toHaveBeenCalledWith(`/studio/${saved!.id}`);
  });

  it("keeps a cut-off stream as an 'Incomplete' outline instead of discarding it", async () => {
    const full = JSON.stringify(geminiPersonalLoan);
    mockStream(full.slice(0, Math.floor(full.length / 2))); // the connection drops halfway
    const user = userEvent.setup();
    render(<GenerateFlow />);

    await generateWith(user);

    expect(await screen.findByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText(/Step 1: Personal Details/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // Nothing half-baked was saved or opened.
    expect(listFlows()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows Retry instead of crashing when the AI answer fails our checks", async () => {
    const broken = structuredClone(geminiPersonalLoan);
    broken.steps[0]!.fields[1]!.id = "full_name"; // duplicate id
    mockStream(JSON.stringify(broken));
    const user = userEvent.setup();
    render(<GenerateFlow />);

    await generateWith(user);

    expect(await screen.findByText("The AI's answer didn't pass our checks")).toBeInTheDocument();
    expect(screen.getByText(/Duplicate field id "full_name"/)).toBeInTheDocument();
    expect(listFlows()).toEqual([]);
  });

  it("shows the server's friendly error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: "Gemini is busy right now. Wait a few seconds and press Retry." }, { status: 503 }),
    );
    const user = userEvent.setup();
    render(<GenerateFlow />);

    await generateWith(user);

    expect(await screen.findByText(/Gemini is busy right now/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
