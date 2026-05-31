import { test, expect } from '@playwright/test';

/**
 * Batch editing affordances: "Add entry" opens the modal on a blank concept and "Done" inserts the row;
 * the per-row ✗ removes a row after a confirm. (Local persistence; the global Save/PR flow needs a
 * configured service, absent in the test build.)
 */
test('adds a new concept and deletes it via the row ✗', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();

  // Add entry → blank modal → set the concept name → Done.
  await page.getByRole('button', { name: '+ Add entry' }).click();
  await page.getByTestId('slug-input').fill('my-new-concept');
  await page.getByTestId('save').click(); // labelled "Done"

  // The new row shows up (filter to make it deterministic).
  await page.getByPlaceholder('Filter concepts…').fill('my-new-concept');
  const row = page.locator('[data-slug="my-new-concept"]').first();
  await expect(row).toBeVisible();

  // Delete it: the ✗ pops a confirm() we accept, then the row is gone.
  page.on('dialog', (d) => d.accept());
  await row.locator('.row-x').click();
  await expect(page.locator('[data-slug="my-new-concept"]')).toHaveCount(0);
});
