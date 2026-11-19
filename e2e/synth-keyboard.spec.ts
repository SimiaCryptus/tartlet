import { expect, test, type Page } from '@playwright/test';

const SYNTH_URL = process.env.SYNTH_KEYBOARD_URL ?? '/';

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test('loads cleanly with no CSP violations and renders initial synth state', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(SYNTH_URL);

  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'suspended');
  await expect(page.locator('#audio-status')).toHaveText('Audio: Click or press a key');
  await expect(page.locator('#active-notes')).toHaveText('Ready');
  await expect(page.locator('#keybed-range')).toHaveText('C3 – C5');
  await expect(page.locator('#backing-badge')).toHaveAttribute('data-state', 'stopped');
  await expect(page.locator('#backing-badge')).toHaveText('Stopped');

  expect(violations).toEqual([]);
});

test('triggers notes via pointer and keyboard with clean status transitions', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(SYNTH_URL);

  const audioStatus = page.locator('#audio-status');
  const activeNotes = page.locator('#active-notes');
  const keyC3 = page.getByRole('button', { name: 'C3 (Key Z)' });

  const box = await keyC3.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height * 0.75);
  await page.mouse.down();

  await expect(audioStatus).not.toHaveAttribute('data-state', 'suspended');
  await expect(activeNotes).not.toHaveText('Ready');

  await page.mouse.up();
  await expect(activeNotes).toHaveText('Ready');

  await page.keyboard.down('q');
  await expect(activeNotes).not.toHaveText('Ready');
  await page.keyboard.up('q');
  await expect(activeNotes).toHaveText('Ready');

  expect(violations).toEqual([]);
});

test('supports Hold / Sustain and Panic (All Notes Off)', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(SYNTH_URL);

  const sustainToggle = page.locator('#sustain-toggle');
  const activeNotes = page.locator('#active-notes');

  await sustainToggle.check();
  await expect(sustainToggle).toBeChecked();

  await page.locator('#keybed').focus();
  await page.keyboard.down('q');
  await page.keyboard.up('q');

  await expect(activeNotes).not.toHaveText('Ready');

  await page.getByRole('button', { name: /Panic/i }).click();
  await expect(activeNotes).toHaveText('Ready');

  expect(violations).toEqual([]);
});

test('updates synth parameters, octave range, and resets patch', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(SYNTH_URL);

  await page.getByRole('button', { name: 'Octave up' }).click();
  await expect(page.locator('#param-octave')).toHaveValue('4');
  await expect(page.locator('#keybed-range')).toHaveText('C4 – C6');

  await page.getByRole('button', { name: 'Octave down' }).click();
  await expect(page.locator('#param-octave')).toHaveValue('3');
  await expect(page.locator('#keybed-range')).toHaveText('C3 – C5');

  await page.locator('#param-sound').selectOption('piano');
  await page.locator('#param-scale').selectOption('minor');
  await page.locator('#param-root').selectOption('A');
  await page.locator('#param-mono').check();

  await page.locator('#param-lpf').fill('1200');
  await expect(page.locator('#out-lpf')).toHaveText('1200 Hz');

  await page.locator('#param-lpq').fill('4.5');
  await expect(page.locator('#out-lpq')).toHaveText('4.5');

  await page.locator('#param-attack').fill('0.25');
  await expect(page.locator('#out-attack')).toHaveText(/0\.25\s*s/);

  await page.locator('#param-gain').fill('0.4');
  await expect(page.locator('#out-gain')).toHaveText('40%');

  await page.getByRole('button', { name: 'Reset patch' }).click();
  await expect(page.locator('#param-sound')).toHaveValue('sawtooth');
  await expect(page.locator('#param-lpf')).toHaveValue('3200');
  await expect(page.locator('#out-lpf')).toHaveText('3200 Hz');
  await expect(page.locator('#param-gain')).toHaveValue('0.7');
  await expect(page.locator('#out-gain')).toHaveText('70%');

  expect(violations).toEqual([]);
});

test('toggles backing pattern panel, switches presets, and runs playback', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(SYNTH_URL);

  const backingPanel = page.locator('#backing-panel');
  await backingPanel.locator('summary').click();

  const editor = page.locator('#backing-editor');
  await expect(editor).toBeVisible();
  const initialSource = await editor.inputValue();

  await page.locator('#backing-preset').selectOption('pad');
  await expect(editor).not.toHaveValue(initialSource);

  const badge = page.locator('#backing-badge');
  await page.locator('#backing-play').click();
  await expect(badge).not.toHaveAttribute('data-state', 'stopped');
  await expect(page.locator('#backing-diags li')).toHaveCount(0);

  await page.locator('#backing-play').click();
  await expect(badge).toHaveAttribute('data-state', 'stopped');

  expect(violations).toEqual([]);
});
