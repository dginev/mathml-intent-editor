import { test, expect } from '@playwright/test';

/**
 * Batch-edit affordances. Changes are local until the global Save: an added row shows green and an
 * unsaved local addition is dropped outright by its ✗; an existing row marked for deletion stays
 * visible (red) and can be restored with the ↺. (The Save/PR flow needs a configured service, absent
 * in the test build, so deletions remain pending here.)
 */
test('adds a concept (green) and the ✗ drops the unsaved addition', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();

  await page.getByRole('button', { name: '+ Add entry' }).click();
  await page.getByTestId('slug-input').fill('my-new-concept');
  await page.getByTestId('save').click(); // labelled "Done"

  await page.getByPlaceholder('Filter concepts…').fill('my-new-concept');
  const row = page.locator('[data-slug="my-new-concept"]').first();
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/row-added/); // pending-add tint

  await row.locator('.row-x').click(); // a local addition has nothing on GitHub → dropped outright
  await expect(page.locator('[data-slug="my-new-concept"]')).toHaveCount(0);
});

test('marks an existing row deleted (kept visible) and restores it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();
  await page.getByPlaceholder('Filter concepts…').fill('abelian-category');

  const row = page.locator('[data-slug="abelian-category"]').first();
  await expect(row).toBeVisible();

  await row.locator('.row-x').click(); // mark for deletion
  await expect(row).toHaveClass(/row-deleted/); // still shown, now red
  await expect(row).toBeVisible();

  await row.locator('.row-x').click(); // ↺ restore
  await expect(row).not.toHaveClass(/row-deleted/);
});
