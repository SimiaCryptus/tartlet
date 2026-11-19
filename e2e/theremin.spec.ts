import { expect, test, type Page } from '@playwright/test';

const THEREMIN_URL = process.env.THEREMIN_URL ?? '/';

function trackCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test('loads cleanly with no CSP violations and renders initial theremin state', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(THEREMIN_URL);

  await expect(page.locator('#audio-status')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#audio-status')).toHaveText('Audio off — touch or click the field to start');
  await expect(page.locator('#theremin-field')).toHaveAttribute('data-active', 'false');
  await expect(page.locator('#theremin-crosshair')).toBeHidden();
  await expect(page.locator('#hold-btn')).toHaveAttribute('aria-pressed', 'false');

  await expect(page.locator('#readout-hz')).toHaveText('— Hz');
  await expect(page.locator('#readout-note')).toHaveText('—');
  await expect(page.locator('#readout-gain')).toHaveText('0.00');
  await expect(page.locator('#readout-cutoff')).toHaveText('— Hz');

  expect(violations).toEqual([]);
});

test('responds to 2D pointer movement and updates live readouts', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(THEREMIN_URL);

  const field = page.locator('#theremin-field');
  const box = await field.boundingBox();
  expect(box).not.toBeNull();

  const readoutHz = page.locator('#readout-hz');
  const readoutNote = page.locator('#readout-note');
  const readoutGain = page.locator('#readout-gain');
  const readoutCutoff = page.locator('#readout-cutoff');

  await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.35);
  await page.mouse.down();

  await expect(field).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#theremin-crosshair')).toBeVisible();
  await expect(page.locator('#audio-status')).not.toHaveAttribute('data-state', 'idle');

  await expect(readoutHz).toHaveText(/\d+(\.\d+)?\s*Hz/);
  await expect(readoutNote).toHaveText(/[A-G]/);
  await expect(readoutCutoff).toHaveText(/\d+(\.\d+)?\s*Hz/);
  await expect.poll(async () => parseFloat((await readoutGain.textContent()) ?? '0')).toBeGreaterThan(0);

  const lowHz = parseFloat((await readoutHz.textContent()) ?? '0');

  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.2);
  await expect.poll(async () => parseFloat((await readoutHz.textContent()) ?? '0')).toBeGreaterThan(lowHz);

  await page.mouse.up();
  await expect(field).toHaveAttribute('data-active', 'false');
  await expect(readoutGain).toHaveText('0.00');

  expect(violations).toEqual([]);
});

test('supports Hold (drone) mode and Panic reset', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(THEREMIN_URL);

  const field = page.locator('#theremin-field');
  const holdBtn = page.locator('#hold-btn');
  const readoutGain = page.locator('#readout-gain');

  await holdBtn.click();
  await expect(holdBtn).toHaveAttribute('aria-pressed', 'true');

  const box = await field.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.up();

  await expect(field).toHaveAttribute('data-active', 'true');
  await expect.poll(async () => parseFloat((await readoutGain.textContent()) ?? '0')).toBeGreaterThan(0);

  await page.locator('#panic-btn').click();
  await expect(field).toHaveAttribute('data-active', 'false');
  await expect(holdBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(readoutGain).toHaveText('0.00');

  expect(violations).toEqual([]);
});

test('updates instrument controls, scale mode, and slider readouts', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(THEREMIN_URL);

  await page.locator('#timbre').selectOption('aah');
  await page.locator('#pitch-mode').selectOption('snap');
  await page.locator('#scale-select').selectOption('pentatonicMinor');
  await page.locator('#scale-root').selectOption('A');

  await page.locator('#freq-min').fill('130');
  await expect(page.locator('#freq-min-val')).toHaveText(/130\s*Hz/);

  await page.locator('#freq-max').fill('1046');
  await expect(page.locator('#freq-max-val')).toHaveText(/1046\s*Hz/);

  await page.locator('#glide-tau').fill('0.1');
  await expect(page.locator('#glide-tau-val')).toHaveText(/0\.10*\s*s/);

  await page.locator('#vibrato-rate').fill('6.5');
  await expect(page.locator('#vibrato-rate-val')).toHaveText(/6\.5\s*Hz/);

  await page.locator('#vibrato-depth').fill('25');
  await expect(page.locator('#vibrato-depth-val')).toHaveText(/25/);

  await page.locator('#filter-cutoff').fill('2400');
  await expect(page.locator('#filter-cutoff-val')).toHaveText(/2400\s*Hz/);

  await page.locator('#filter-q').fill('4');
  await expect(page.locator('#filter-q-val')).toHaveText(/4(\.0)?/);

  await page.locator('#room-amount').fill('0.5');
  await expect(page.locator('#room-amount-val')).toHaveText(/0\.50?/);

  await page.locator('#delay-amount').fill('0.35');
  await expect(page.locator('#delay-amount-val')).toHaveText(/0\.35/);

  expect(violations).toEqual([]);
});

test('configures Tartlet accompaniment presets and applies cleanly', async ({ page }) => {
  const violations = trackCspViolations(page);
  await page.goto(THEREMIN_URL);

  const source = page.locator('#accomp-source');
  const initialSource = await source.inputValue();

  await page.locator('#accomp-preset').selectOption('drone');
  await expect(source).not.toHaveValue(initialSource);

  const enabled = page.locator('#accomp-enabled');
  await enabled.check();
  await expect(enabled).toBeChecked();

  await page.locator('#accomp-apply').click();
  await expect(page.locator('#accomp-diags li')).toHaveCount(0);

  await enabled.uncheck();
  await expect(enabled).not.toBeChecked();

  expect(violations).toEqual([]);
});
