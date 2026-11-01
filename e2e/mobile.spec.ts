import { expect, test } from '@playwright/test';

// Own file: editor.spec.ts's beforeEach waits for the cast panel, which on a
// phone is an off-canvas drawer (hidden) — its wait would time out here.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('page never overflows the phone screen', async ({ page }) => {
  // Regression (≤v0.8.2): .timeline-panel was the only narrow-mode grid
  // item without overflow containment, so its no-wrap toolbar stretched
  // the single column to ~890px — stage and topbar ran off a 390px screen
  // with no way to pan to them.
  await page.addInitScript(() => {
    localStorage.setItem(
      'gridstage-locale',
      JSON.stringify({ state: { locale: 'en' }, version: 0 }),
    );
  });
  await page.goto('/');
  await expect(page.locator('.app-narrow')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Cast' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
