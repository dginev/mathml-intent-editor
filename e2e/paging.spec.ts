import { test, expect } from '@playwright/test';

/**
 * Requirement: the full concept list (10k+ rows) must be reachable by paging down — repeatedly
 * scrolling and letting the virtualizer render the next window — to exhaustion, within 1 minute,
 * with no crashes.
 *
 * We assert the row at index `total - 1` eventually renders, while watching for any uncaught page
 * error. The scroll container, rows, and total count are exposed via test ids.
 */
test('pages through the entire list to exhaustion within a minute', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));

  await page.goto('/');

  // Total row count, surfaced in the header. The dictionary loads asynchronously, so wait for it.
  const count = page.getByTestId('concept-count');
  await expect
    .poll(async () => Number((await count.getAttribute('data-total')) ?? '0'), { timeout: 30_000 })
    .toBeGreaterThan(10_000);
  const total = Number((await count.getAttribute('data-total'))!);

  const scroll = page.getByTestId('table-scroll');
  await expect(scroll).toBeVisible();

  const lastRow = page.locator(`[data-row-index="${total - 1}"]`);

  const budgetMs = 60_000;
  const start = Date.now();
  while ((await lastRow.count()) === 0) {
    if (Date.now() - start > budgetMs) {
      throw new Error(`Did not reach the last row (#${total - 1}) within ${budgetMs}ms`);
    }
    // Page down by ~one viewport and let the virtualizer render the next window.
    await scroll.evaluate((el) => el.scrollBy(0, el.clientHeight));
    await page.waitForTimeout(10);
    expect(pageErrors, `page crashed: ${pageErrors[0]?.message}`).toHaveLength(0);
  }

  await expect(lastRow).toBeVisible();
  expect(pageErrors).toHaveLength(0);

  const elapsed = Date.now() - start;
  console.log(`Reached row #${total - 1} of ${total} in ${elapsed}ms`);
  expect(elapsed).toBeLessThan(budgetMs);
});
