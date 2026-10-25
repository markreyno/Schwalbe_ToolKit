import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';

const artifactDir = path.resolve('/opt/cursor/artifacts/screenshots', 'picker-water-log');

test('picker watering log keeps three newest timestamps', async () => {
  await mkdir(artifactDir, { recursive: true });
  const testProfile = path.resolve('.cache/picker-water-log', randomUUID());
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    TOOLKIT_TEST_DATA: testProfile,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.TOOLKIT_EXECUTABLE ? { executablePath: process.env.TOOLKIT_EXECUTABLE } : { args: ['.'] }),
    env,
  });
  const page = await app.firstWindow();
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'Picker Water Scheduler' }) }).getByRole('link').click();
  await page.getByLabel('Picker name').fill('Log Test Picker');
  await page.getByLabel('Water every (days)').fill('14');
  await page.getByLabel('Last watered').fill('2020-01-01');
  await page.getByRole('button', { name: 'Add picker' }).click();
  const mark = page.getByRole('button', { name: 'Mark watered' });
  for (let i = 0; i < 4; i++) {
    await mark.click();
    await page.waitForTimeout(50);
  }
  const entries = page.locator('.water-log li');
  await expect(entries).toHaveCount(3);
  await page.screenshot({ path: path.join(artifactDir, 'picker-three-entry-log.png'), fullPage: true });
  await app.close();
});
