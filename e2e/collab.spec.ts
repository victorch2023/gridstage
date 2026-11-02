import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The suite uses expert-only tools (props) — force expert mode (default easy). */
async function forceExpert(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'gridstage-layout',
      JSON.stringify({ state: { uiMode: 'expert' }, version: 0 }),
    );
    localStorage.setItem(
      'gridstage-locale',
      JSON.stringify({ state: { locale: 'en' }, version: 0 }),
    );
  });
}

test('two clients collaborate in a room: doc sync, presence, comments', async ({ browser }) => {
  const room = `e2e-${Date.now()}`;
  const url = `/?room=${room}`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await forceExpert(pageA);
  await forceExpert(pageB);

  // A joins first and creates content.
  await pageA.goto(url);
  await pageA.getByText('Add performer').waitFor();
  await pageA.getByText('Add performer').click();
  await pageA.getByLabel('Performance title').fill('Synced show');
  // Deselect the new performer so A's panel shows FORMATION comments
  // (adding a performer auto-selects it).
  await pageA.getByLabel('Stage canvas').click({ position: { x: 15, y: 15 } });

  // B joins late — must receive A's history from the relay.
  await pageB.goto(url);
  await pageB.getByText('Add performer').waitFor();
  await expect(pageB.locator('.cast-row')).toHaveCount(1, { timeout: 10_000 });
  await expect(pageB.getByLabel('Performance title')).toHaveValue('Synced show');

  // Presence: each side shows two dots (self + peer).
  await expect(pageA.locator('.presence-dot')).toHaveCount(2, { timeout: 10_000 });
  await expect(pageB.locator('.presence-dot')).toHaveCount(2);

  // B comments on the formation; A sees it.
  await pageB.getByLabel('New comment').fill('note from B');
  await pageB.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(pageA.getByText('note from B')).toBeVisible({ timeout: 10_000 });

  // A adds a prop; B receives it (props sync through their own Y map).
  await pageA.getByRole('button', { name: 'Labelled objects' }).click();
  await expect(pageB.getByRole('option', { name: 'Prop 1' })).toBeVisible({ timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});

test('follow mode mirrors the peer playhead and formation', async ({ browser }) => {
  const room = `e2e-follow-${Date.now()}`;
  const url = `/?room=${room}`;

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  for (const page of [pageA, pageB]) {
    await page.addInitScript(() => {
      localStorage.setItem(
        'gridstage-locale',
        JSON.stringify({ state: { locale: 'en' }, version: 0 }),
      );
    });
  }

  await pageA.goto(url);
  await pageA.getByText('Add performer').waitFor();
  await pageA.getByText('Add formation').click(); // F2 at 12s, selected on A

  await pageB.goto(url);
  await pageB.getByText('Add performer').waitFor();
  await expect(pageB.getByRole('button', { name: /Formation 2/ })).toBeVisible({
    timeout: 10_000,
  });

  // B follows A (the only peer dot button).
  await pageB.getByRole('button', { name: /^Follow / }).click();

  // A selects Formation 2 and steps the playhead to exactly 15s.
  await pageA.getByRole('button', { name: /Formation 2/ }).click();
  await pageA.getByLabel('Playhead position').click({ position: { x: 1, y: 1 } }); // scrub to ~0
  for (let i = 0; i < 3; i++) {
    await pageA.getByLabel('Playhead position').press('Shift+ArrowRight'); // +5s each
  }

  // B's playhead and selected formation mirror A's.
  await expect(pageB.getByLabel('Playhead time')).toContainText('0:15', { timeout: 10_000 });
  await expect(pageB.getByRole('button', { name: /Formation 2/ })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10_000 },
  );

  await ctxA.close();
  await ctxB.close();
});
