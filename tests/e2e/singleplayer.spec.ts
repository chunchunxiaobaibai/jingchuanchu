import { test, expect } from '@playwright/test';

test('singleplayer plays, pauses and restarts with all network connections blocked', async ({
  page,
}) => {
  let sockets = 0;
  const errors: string[] = [];
  await page.routeWebSocket(/.*/, () => {
    sockets++;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/singleplayer/');
  await expect(page.locator('#score')).toHaveText('0 / 5');
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('Missing canvas');
  await page.mouse.click(
    box.x + box.width * ((0.2 * 960 + 9) / 960),
    box.y + box.height * ((0.25 * 600 + 9) / 600),
  );
  await expect(page.locator('#score')).toHaveText('1 / 5');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('#status')).toContainText('游戏已暂停');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await page.getByRole('button', { name: '重新开始' }).click();
  await expect(page.locator('#score')).toHaveText('0 / 5');
  await page.locator('#canvas').focus();
  await page.keyboard.down('ArrowRight');
  const before = await page.locator('#canvas').screenshot();
  await expect
    .poll(async () => (await page.locator('#canvas').screenshot()).equals(before))
    .toBe(false);
  await page.keyboard.up('ArrowRight');
  await page.screenshot({ path: 'test-results/singleplayer-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(sockets).toBe(0);
  expect(errors).toEqual([]);
});
