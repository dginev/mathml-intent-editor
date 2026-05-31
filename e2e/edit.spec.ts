import { test, expect } from '@playwright/test';

/**
 * The edit loop: click a concept row → author TeX with `\arg{N}{…}` → see the annotated MathML
 * preview → Save → the table cell reflects the new notation (local persistence; the PR flow comes
 * later).
 */
test('edits a concept notation from TeX and reflects it in the table', async ({ page }) => {
  await page.goto('/');

  // Narrow to a single known concept so the target row is deterministic.
  await page.getByTestId('concept-count').waitFor();
  await page.getByPlaceholder('Filter concepts…').fill('additive-inverse');

  const row = page.locator('[data-slug="additive-inverse"]').first();
  await expect(row).toBeVisible();
  await row.locator('.row-edit').click(); // editing is icon-based; the row itself isn't clickable

  // Editor opens; author TeX and confirm the live preview is annotated.
  const tex = page.getByTestId('tex-input');
  await expect(tex).toBeVisible();
  await tex.fill('-\\arg{x}{n}');

  const preview = page.getByTestId('preview');
  await expect(preview.locator('[intent="additive-inverse($x)"]')).toBeVisible();

  await page.getByTestId('save').click();

  // Editor closes and the row's notation cell now carries the new intent annotation.
  await expect(tex).toHaveCount(0);
  await expect(row.locator('[intent="additive-inverse($x)"]')).toHaveCount(1);
});
