// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { componentName, toReactComponent } from "./toReact";
import { samplePersonalLoan as sample } from "@/lib/schema/sample";
import type { FormSchema } from "@/lib/schema/types";
import geminiPersonalLoan from "@/lib/schema/fixtures/gemini-personal-loan.json";

/**
 * The strongest test of a code generator: write its output to disk, then
 *  1. type-check it with the real TypeScript compiler (strict mode), and
 *  2. import it and USE it like a customer would.
 * The folder is git-ignored.
 */
const OUT_DIR = join(process.cwd(), "lib/export/__generated__");

function writeExport(schema: FormSchema, file: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, file);
  writeFileSync(path, toReactComponent(schema).code);
  return path;
}

/** A label written to break out of a string. It must stay a harmless string. */
const evil: FormSchema = {
  name: 'Evil */ "form"',
  purpose: "Line one\nalert('purpose')",
  steps: [
    {
      id: "s1",
      title: '"}); throw new Error("pwned"); ({"',
      fields: [
        { id: "x", type: "text", label: '"}); throw new Error("pwned"); ({"', helpText: "{alert(1)}", required: true },
        {
          id: "c",
          type: "select",
          label: "<script>",
          required: true,
          options: [
            { label: "A'\"`${x}", value: 'a"b' },
            { label: "B", value: "b" },
          ],
        },
      ],
    },
  ],
};

let files: string[] = [];
beforeAll(() => {
  files = [
    writeExport(sample, "SampleLoan.tsx"),
    writeExport(geminiPersonalLoan as FormSchema, "GeminiLoan.tsx"),
    writeExport(evil, "Evil.tsx"),
  ];
});
afterEach(cleanup);

describe("toReactComponent", () => {
  it("names the component and file from the schema name", () => {
    expect(componentName(sample)).toBe("PersonalLoanKycForm");
    expect(componentName({ ...sample, name: "123 go!" })).toBe("Kyc123GoForm");
    expect(componentName({ ...sample, name: "Signup form" })).toBe("SignupForm");
    expect(toReactComponent(sample).fileName).toBe("PersonalLoanKycForm.tsx");
  });

  it("compiles under strict TypeScript, including the hostile labels", () => {
    const program = ts.createProgram(files, {
      strict: true,
      noEmit: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      esModuleInterop: true,
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => `${d.file?.fileName.split("/").pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(errors).toEqual([]);
  }, 60_000);

  it("only includes the helpers the form uses", () => {
    const { code } = toReactComponent(evil);
    expect(code).not.toContain("PAN_RE");
    expect(code).not.toContain("isValidGstin");
    expect(toReactComponent(sample).code).toContain("function isValidGstin");
  });

  it("keeps a stable shape (snapshot)", () => {
    expect(toReactComponent(sample).code).toMatchSnapshot();
  });
});

describe("the exported component, actually used", () => {
  async function load(file: string) {
    const mod: { default: ComponentType<{ onSubmit: (v: unknown) => void }> } = await import(
      /* @vite-ignore */ join(OUT_DIR, file)
    );
    return mod.default;
  }
  const byLabel = (text: string) => screen.getByLabelText(new RegExp(`^${text}`));

  it("validates PAN and GSTIN (with checksum), hides GSTIN for salaried, and submits", async () => {
    const Form = await load("SampleLoan.tsx");
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Form onSubmit={onSubmit} />);

    await user.type(byLabel("Full name"), "Asha Rao");
    await user.type(byLabel("Date of birth"), "1995-04-12");
    await user.type(byLabel("Mobile number"), "9876543210");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Step 2 of 3/)).toBeInTheDocument();

    await user.click(byLabel("I agree to share"));
    await user.type(byLabel("PAN"), "ABCDE1234F"); // invalid holder type
    await user.type(byLabel("Last 4 digits of Aadhaar"), "1234");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Enter a valid PAN, e.g. ABCPD1234E")).toBeInTheDocument();

    await user.clear(byLabel("PAN"));
    await user.type(byLabel("PAN"), "abcpd1234e");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Step 3 of 3/)).toBeInTheDocument();

    // GSTIN appears only for self-employed, and its checksum is enforced.
    expect(screen.queryByLabelText(/^GSTIN/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Self-employed"));
    await user.type(byLabel("GSTIN"), "27AAPFU0939F1ZW"); // typo in check digit
    await user.type(byLabel("Monthly income"), "85000");
    await user.type(byLabel("Bank IFSC"), "HDFC0001234");
    await user.type(byLabel("Bank account number"), "123456789012");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Enter a valid GSTIN")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    // Switch to salaried: GSTIN disappears and no longer blocks submit.
    await user.click(screen.getByLabelText("Salaried"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
    expect(values).toMatchObject({ full_name: "Asha Rao", pan_number: "ABCPD1234E", employment_type: "salaried", kyc_consent: true });
    expect(values.gstin).toBeUndefined();
  }, 20_000); // a full 3-step customer journey; slow when the whole suite runs in parallel

  it("renders hostile labels as plain text, not code", async () => {
    const Form = await load("Evil.tsx");
    render(<Form onSubmit={vi.fn()} />);
    // The hostile text is the step title AND the field label: both render as plain text.
    expect(screen.getByRole("textbox", { name: /throw new Error\("pwned"\)/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /throw new Error\("pwned"\)/ })).toBeInTheDocument();
    expect(screen.getByText("{alert(1)}")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "A'\"`${x}" })).toBeInTheDocument();
  });
});
