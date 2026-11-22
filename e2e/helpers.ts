import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

/** A real response recorded from Gemini (see lib/schema/fixtures). */
export const geminiPersonalLoan = JSON.parse(
  readFileSync(join(__dirname, "../lib/schema/fixtures/gemini-personal-loan.json"), "utf8"),
) as Record<string, unknown>;

/** A flow with deliberate problems: PAN with no consent, and not masked. */
export const riskyFlow = {
  name: "Risky KYC",
  purpose: "Verify identity for a savings account",
  steps: [
    {
      id: "basics",
      title: "Basics",
      fields: [
        { id: "full_name", type: "text", label: "Full name", required: true },
        { id: "mobile", type: "mobile", label: "Mobile number", required: true },
        { id: "email", type: "email", label: "Email", required: false },
      ],
    },
    {
      id: "identity",
      title: "Identity",
      fields: [{ id: "pan_number", type: "pan", label: "PAN", required: true }],
    },
  ],
};

/**
 * Mock the AI at the network edge: the browser asks /api/generate, and we answer
 * with a fixed schema instead of calling Gemini. Fast, free, same result every run.
 */
export async function mockGenerate(page: Page, schema: unknown) {
  await page.route("**/api/generate", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: JSON.stringify(schema) }),
  );
}

/** Dashboard → type a prompt → Generate → wait until the studio has opened. */
export async function generateFlow(page: Page, schema: unknown) {
  await mockGenerate(page, schema);
  await page.goto("/");
  await page.getByLabel("Describe your onboarding flow").fill("Personal loan KYC with PAN, Aadhaar last 4 and bank details.");
  await page.getByRole("button", { name: "Generate form" }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
