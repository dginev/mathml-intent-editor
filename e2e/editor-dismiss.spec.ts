import { test, expect, type Page } from '@playwright/test';

/**
 * Dismissal robustness for the editor modal (round-2 follow-up: edits were too easy to lose).
 * Only a TRUE backdrop click — press AND release outside the dialog's box — may dismiss it:
 * clicks on the modal's own padding/scrollbar (which also target the <dialog>) and text-selection
 * drags released outside must not; and a dirty editor must always ask before discarding.
 */
async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByTestId('concept-count').waitFor();
  await page.getByPlaceholder('Filter concepts…').fill('additive-inverse');
  const row = page.locator('[data-slug="additive-inverse"]').first();
  await row.locator('.row-edit').click();
  await expect(page.getByTestId('notation-editor')).toBeVisible();
}

test('clicks on the modal padding / scrollbar gutter do not dismiss the editor', async ({ page }) => {
  await openEditor(page);
  const box = (await page.locator('dialog.modal[open]').boundingBox())!;
  // Just inside the dialog's right edge — its own padding/scrollbar gutter, NOT the backdrop.
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  await expect(page.getByTestId('notation-editor')).toBeVisible();
});

test('a clean editor closes on a true backdrop click, with no prompt', async ({ page }) => {
  await openEditor(page);
  const prompts: string[] = [];
  page.on('dialog', (d) => {
    prompts.push(d.message());
    void d.dismiss();
  });
  await page.mouse.click(8, 8); // far corner — definitely the backdrop
  await expect(page.getByTestId('notation-editor')).toHaveCount(0);
  expect(prompts).toEqual([]); // nothing to discard → no confirm dialog
});

test('a dirty editor asks before discarding on a backdrop click', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('tex-input').fill('-\\arg{x}{n}'); // unsaved work

  const prompts: string[] = [];
  page.once('dialog', (d) => {
    prompts.push(d.message());
    void d.dismiss(); // refuse the discard
  });
  await page.mouse.click(8, 8);
  await expect(page.getByTestId('notation-editor')).toBeVisible(); // refused → still open
  expect(prompts[0]).toContain('Discard');

  page.once('dialog', (d) => void d.accept()); // now accept it
  await page.mouse.click(8, 8);
  await expect(page.getByTestId('notation-editor')).toHaveCount(0); // accepted → closed
});

test('releasing a text-selection drag outside the modal does not dismiss it', async ({ page }) => {
  await openEditor(page);
  const tex = page.getByTestId('tex-input');
  await tex.fill('-\\arg{x}{n}');
  const prompts: string[] = [];
  page.on('dialog', (d) => {
    prompts.push(d.message());
    void d.dismiss();
  });
  const b = (await tex.boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + 10); // start selecting inside the textarea…
  await page.mouse.down();
  await page.mouse.move(8, 8, { steps: 5 }); // …and release out on the backdrop
  await page.mouse.up();
  await expect(page.getByTestId('notation-editor')).toBeVisible(); // selection, not a dismissal
  expect(prompts).toEqual([]);
});
