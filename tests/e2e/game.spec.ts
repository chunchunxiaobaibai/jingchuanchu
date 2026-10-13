import { test, expect } from '@playwright/test';

test('two browsers play, share the canvas, score and switch the drawing player', async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const host = await a.newPage();
  const guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }
  await host.goto('/');
  await expect(host.getByRole('button', { name: '创建房间' })).toBeEnabled();
  await host.getByLabel('你的昵称').fill('小白');
  await host.getByRole('button', { name: '创建房间' }).click();
  await expect(host.locator('#room-id')).toHaveText(/^[A-Z0-9]{6}$/);
  const code = await host.locator('#room-id').innerText();
  await guest.goto('/');
  await guest.getByLabel('你的昵称').fill('小青');
  await guest.getByLabel('房间码', { exact: true }).fill(code);
  await guest.getByRole('button', { name: '加入', exact: true }).click();
  await expect(host.locator('#player-count')).toHaveText('2 / 10');
  await host.getByRole('button', { name: '开始游戏' }).click();
  await expect(host.locator('#phase')).toHaveText('你来画');
  await expect(guest.locator('#phase')).toHaveText('你来猜');
  const word = (await host.locator('#prompt').innerText()).replace('题目：', '');
  await expect(guest.locator('#prompt')).toHaveText(/提示：/);
  const before = await guest.locator('#canvas').screenshot();
  const box = await host.locator('#canvas').boundingBox();
  if (!box) throw new Error('No canvas');
  await host.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await host.mouse.down();
  await host.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 10 });
  await host.mouse.up();
  await expect
    .poll(async () => (await guest.locator('#canvas').screenshot()).equals(before))
    .toBe(false);
  await host.screenshot({ path: 'test-results/game-desktop.png', fullPage: true });
  await guest.getByLabel('输入你猜的词').fill(word);
  await guest.getByRole('button', { name: '发送猜测' }).click();
  await expect(host.locator('#phase')).toHaveText('答案揭晓');
  await expect(guest.locator('#messages')).toContainText('猜对了！');
  await expect(guest.locator('#players')).toContainText('100');
  await expect(host.locator('#players')).toContainText('25');
  await host.getByRole('button', { name: '下一回合' }).click();
  await expect(guest.locator('#phase')).toHaveText('你来画');
  await expect(host.locator('#phase')).toHaveText('你来猜');
  await expect(host.locator('#prompt')).toHaveText(/提示：/);
  await guest.getByRole('button', { name: '离开房间' }).click();
  await expect(guest.getByRole('button', { name: '创建房间' })).toBeVisible();
  await expect(host.locator('#phase')).toHaveText('等待开始');
  await expect(host.locator('#player-count')).toHaveText('1 / 10');
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test('mobile layout, invalid room, input escaping and keyboard entry', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page.getByLabel('你的昵称').fill('<b>玩家</b>');
  await page.getByLabel('房间码', { exact: true }).fill('ZZZZZZ');
  await page.getByRole('button', { name: '加入', exact: true }).click();
  await expect(page.locator('#notice')).toHaveText('房间不存在');
  await page.getByRole('button', { name: '创建房间' }).click();
  await expect(page.locator('#players')).toContainText('<b>玩家</b>');
  await expect(page.locator('#notice')).toBeHidden();
  expect(await page.locator('#players b').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/game-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '离开房间' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#lobby')).toBeVisible();
});
