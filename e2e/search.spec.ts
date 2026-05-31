import { test, expect } from '@playwright/test';

/**
 * Search/filter: the Filter searches the WHOLE dictionary (not just the rows paged into view), and
 * Ctrl/⌘+F is rebound to focus it (the browser's native find can't see the virtualized rows).
 */
test('Filter finds a concept far beyond the loaded prefix', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();

  // `power-1000` is a deep seed clone (~9000th row) — never in the initial paged window.
  const deep = page.locator('[data-slug="power-1000"]');
  await expect(deep).toHaveCount(0); // not rendered before filtering

  await page.getByPlaceholder('Filter concepts…').fill('power-1000');
  await expect(deep.first()).toBeVisible(); // full-dictionary search surfaces it
});

test('Ctrl+F focuses the Filter input instead of the browser find', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();

  const filter = page.getByPlaceholder('Filter concepts…');
  await page.locator('body').click(); // move focus off the input
  await expect(filter).not.toBeFocused();

  await page.keyboard.press('Control+f');
  await expect(filter).toBeFocused();
});
