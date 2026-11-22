import { expect, test } from "@playwright/test";
import { generateFlow, geminiPersonalLoan, riskyFlow } from "./helpers";

test("generate a flow from a prompt: the studio opens with 3 steps", async ({ page }) => {
  await generateFlow(page, geminiPersonalLoan);

  await expect(page.getByRole("heading", { name: "Personal Loan KYC", level: 1 })).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();

  // It's saved: the dashboard lists it after navigating back.
  await page.getByRole("link", { name: "← All flows" }).click();
  await expect(page.getByRole("link", { name: /Personal Loan KYC/ })).toBeVisible();
});

test("customer preview: an invalid PAN shows an error, a valid one passes", async ({ page }) => {
  await generateFlow(page, geminiPersonalLoan);
  const preview = page.getByRole("region", { name: "Customer preview" });

  await preview.getByLabel(/^Full Name/).fill("Asha Rao");
  await preview.getByLabel(/^Date of Birth/).fill("1995-04-12");
  await preview.getByLabel(/^I agree to share/).check();
  await preview.getByLabel(/^PAN Number/).fill("ABCDE1234F"); // 4th letter isn't a holder type
  await preview.getByLabel(/^Last 4 Digits of Aadhaar/).fill("1234");
  await preview.getByRole("button", { name: "Next" }).click();

  await expect(preview.getByText("Enter a valid PAN, e.g. ABCPD1234E")).toBeVisible();
  await expect(preview.getByText("Step 1 of 3")).toBeVisible();

  await preview.getByLabel(/^PAN Number/).fill("abcpd1234e");
  await preview.getByRole("button", { name: "Next" }).click();
  await expect(preview.getByText("Step 2 of 3")).toBeVisible();
});

test("run checks, click Fix it: the issue disappears, and Undo brings it back", async ({ page }) => {
  await generateFlow(page, riskyFlow);
  const checks = page.getByRole("tabpanel");

  await expect(checks.getByText(/"PAN" is sensitive but not marked for masking/)).toBeVisible();
  await checks.getByRole("button", { name: "Fix it: Mark as sensitive" }).click();
  await expect(checks.getByText(/not marked for masking/)).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(checks.getByText(/not marked for masking/)).toBeVisible();
});

test("export: the code panel contains a React Hook Form component", async ({ page }) => {
  await generateFlow(page, geminiPersonalLoan);
  await page.getByRole("tab", { name: "Export" }).click();

  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("PersonalLoanKycForm.tsx")).toBeVisible();
  await expect(panel).toContainText("useForm");
  await expect(panel).toContainText("function isValidGstin");
});

test("drag and drop with the KEYBOARD reorders fields (accessible dnd)", async ({ page }) => {
  await generateFlow(page, riskyFlow);
  const outline = page.getByRole("navigation", { name: "Form outline" });
  // The field-name buttons are the ones with an aria-pressed attribute (selected or not).
  const fieldNames = () => outline.getByRole("region", { name: /Step 1/ }).locator("button[aria-pressed]").allTextContents();

  expect(await fieldNames()).toEqual(["Full name", "Mobile number", "Email"]);

  // Space picks up, ArrowUp moves, Space drops: no mouse needed.
  // Each step waits for the screen-reader announcement, which proves the
  // announcements work AND avoids racing dnd-kit (no arbitrary sleeps).
  await outline.getByRole("button", { name: "Drag to reorder Mobile number" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Picked up Mobile number.")).toBeAttached();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("Mobile number is over Full name.")).toBeAttached();
  await page.keyboard.press("Space");

  await expect.poll(fieldNames).toEqual(["Mobile number", "Full name", "Email"]);
  await expect(page.getByText("Applied: Move Mobile number")).toBeVisible();
});

test("a flow that doesn't exist shows a helpful message", async ({ page }) => {
  await page.goto("/studio/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText("This flow doesn't exist.")).toBeVisible();
});
