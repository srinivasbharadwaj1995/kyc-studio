import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { generateFlow, riskyFlow } from "./helpers";

/**
 * Automated accessibility checks with axe-core (WCAG 2.1 A + AA rules).
 * axe catches roughly a third to half of real issues (labels, contrast, ARIA
 * misuse). Keyboard and screen-reader testing still matter; this is the floor.
 *
 * Both colour schemes: grey text that passes on white can fail on black.
 * (Lighthouse caught exactly that in dark mode after light-only checks passed.)
 */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function summarise(violations: { id: string; impact?: string | null; nodes: { target: unknown }[] }[]) {
  return violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.map((n) => String(n.target)).join(", ")})`);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test("dashboard has no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/");
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(summarise(violations)).toEqual([]);
    });

    test("studio (preview, outline, checks) has no WCAG A/AA violations", async ({ page }) => {
      await generateFlow(page, riskyFlow);
      await expect(page.getByText(/issues?:/)).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(summarise(violations)).toEqual([]);
    });
  });
}
