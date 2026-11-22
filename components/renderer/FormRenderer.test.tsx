// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormRenderer } from "./FormRenderer";
import { samplePersonalLoan } from "@/lib/schema/sample";

afterEach(cleanup);

type User = ReturnType<typeof userEvent.setup>;

// Labels end with a "*" for required fields, so match by the start of the text.
const byLabel = (text: string) => screen.getByLabelText(new RegExp(`^${text}`));
const queryByLabel = (text: string) => screen.queryByLabelText(new RegExp(`^${text}`));
const next = (user: User) => user.click(screen.getByRole("button", { name: "Next" }));

async function fillStep1(user: User) {
  await user.type(byLabel("Full name"), "Asha Rao");
  // jsdom can't type into date inputs char by char, so set the value directly.
  fireEvent.change(byLabel("Date of birth"), { target: { value: "1995-04-12" } });
  await user.type(byLabel("Mobile number"), "9876543210");
}

async function fillStep2(user: User) {
  await user.click(byLabel("I agree to share"));
  await user.type(byLabel("PAN"), "abcpd1234e");
  await user.type(byLabel("Last 4 digits of Aadhaar"), "1234");
}

async function goToStep3(user: User) {
  await fillStep1(user);
  await next(user);
  await fillStep2(user);
  await next(user);
  await screen.findByText("Step 3 of 3");
}

async function fillBankAndIncome(user: User) {
  await user.type(byLabel("Monthly income"), "85000");
  await user.type(byLabel("Bank IFSC"), "hdfc0001234");
  await user.type(byLabel("Bank account number"), "123456789012");
}

describe("FormRenderer: navigation", () => {
  it("shows the first step and a progress indicator", () => {
    render(<FormRenderer schema={samplePersonalLoan} />);
    expect(screen.getByRole("heading", { name: "Basic details" })).toBeVisible();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("blocks Next and shows errors when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={samplePersonalLoan} />);

    await next(user);

    expect(await screen.findByText("Full name is required")).toBeInTheDocument();
    expect(byLabel("Full name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("moves forward and back, keeping typed values", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={samplePersonalLoan} />);

    await fillStep1(user);
    await next(user);
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Identity" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(byLabel("Full name")).toHaveValue("Asha Rao");
  });
});

describe("FormRenderer: Indian validation", () => {
  it("blocks an invalid PAN and accepts a valid one", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={samplePersonalLoan} />);
    await fillStep1(user);
    await next(user);

    await user.click(byLabel("I agree to share"));
    await user.type(byLabel("PAN"), "ABCDE1234F"); // 4th char D is not a holder type
    await user.type(byLabel("Last 4 digits of Aadhaar"), "1234");
    await next(user);
    expect(await screen.findByText(/Enter a valid PAN/)).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

    await user.clear(byLabel("PAN"));
    await user.type(byLabel("PAN"), "abcpd1234e");
    await next(user);
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
  });
});

describe("FormRenderer: conditional fields (showIf)", () => {
  it("shows GSTIN only for self-employed", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={samplePersonalLoan} />);
    await goToStep3(user);

    expect(queryByLabel("GSTIN")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Self-employed"));
    expect(byLabel("GSTIN")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Salaried"));
    expect(queryByLabel("GSTIN")).not.toBeInTheDocument();
  });

  it("lets a salaried user submit without GSTIN, and drops a GSTIN typed earlier", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormRenderer schema={samplePersonalLoan} onSubmit={onSubmit} />);
    await goToStep3(user);

    // Type a GSTIN as self-employed, then change mind to salaried.
    await user.click(screen.getByLabelText("Self-employed"));
    await user.type(byLabel("GSTIN"), "27AAPFU0939F1ZV");
    await user.click(screen.getByLabelText("Salaried"));
    await fillBankAndIncome(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("gstin");
  });

  it("submits all values for a self-employed user, normalised", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<FormRenderer schema={samplePersonalLoan} onSubmit={onSubmit} />);
    await goToStep3(user);

    await user.click(screen.getByLabelText("Self-employed"));
    await user.type(byLabel("GSTIN"), "27aapfu0939f1zv");
    await fillBankAndIncome(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      full_name: "Asha Rao",
      kyc_consent: true,
      pan_number: "ABCPD1234E",
      employment_type: "self_employed",
      gstin: "27AAPFU0939F1ZV",
      ifsc: "HDFC0001234",
      account_number: "123456789012",
    });
  });
});

describe("FormRenderer: masking", () => {
  it("masks sensitive fields until the user presses Show", async () => {
    const user = userEvent.setup();
    render(<FormRenderer schema={samplePersonalLoan} />);
    await fillStep1(user);
    await next(user);

    const pan = byLabel("PAN");
    expect(pan).toHaveAttribute("data-masked", "true");
    expect(byLabel("Full name")).not.toHaveAttribute("data-masked");

    await user.click(screen.getByRole("button", { name: "Show PAN" }));
    expect(pan).not.toHaveAttribute("data-masked");
    expect(screen.getByRole("button", { name: "Hide PAN" })).toHaveAttribute("aria-pressed", "true");
  });
});
