import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.testSounds = { starts: 0, media: [] };
    const Audio = window.Audio;
    window.Audio = function (...args) {
      const media = new Audio(...args);
      window.testSounds.media.push(media);
      return media;
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.testSounds.starts += 1;
      return start.apply(this, args);
    };
  });
});

test('page, self-hosted assets, touch targets and layout', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('head empty.mjav loud.');
  await expect(page.locator('[data-sound]')).toHaveCount(10);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('800 16px "Bricolage Grotesque"'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dimensions = await page.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => {
    const { width, height } = button.getBoundingClientRect();
    return { width, height };
  }));
  expect(dimensions.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  for (const asset of ['/meow.wav', '/fonts/bricolage-grotesque-latin.woff2', '/cat.svg']) {
    expect((await page.request.get(asset)).status()).toBe(200);
  }
  expect(errors).toEqual([]);
  await page.locator('#arcade').screenshot({ path: testInfo.outputPath('arcade.png') });
  await page.locator('.soundboard').screenshot({ path: testInfo.outputPath('soundboard.png') });
});

test('every new voice synthesizes audio and game effects respect mute', async ({ page }) => {
  await page.goto('/');
  for (const kind of ['eepy', 'ufo', 'honk', 'bonk', 'boing', 'ascend']) {
    const before = await page.evaluate(() => window.testSounds.starts);
    await page.locator(`[data-sound="${kind}"]`).click();
    await expect.poll(() => page.evaluate(() => window.testSounds.starts)).toBeGreaterThan(before);
    await page.waitForTimeout(800);
  }
  await page.locator('#mute-button').click();
  const before = await page.evaluate(() => window.testSounds.starts);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cat:game-sound', { detail: { kind: 'bonk' } })));
  expect(await page.evaluate(() => window.testSounds.starts)).toBe(before);
  await expect(page.locator('#status-text')).toContainText('bonk');
});

test('real meow plays, and mute silences current and future sounds', async ({ page }) => {
  await page.goto('/');
  await page.locator('#cat-button').click();
  await expect.poll(() => page.evaluate(() => window.testSounds.media[0].paused)).toBe(false);
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await expect(page.getByRole('button', { name: 'Mute sound' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.testSounds.media[0].paused)).toBe(true);
  for (const button of await page.locator('[data-sound]').all()) await button.click();
  expect(await page.evaluate(() => window.testSounds.starts)).toBe(0);
  expect(await page.evaluate(() => window.testSounds.media[0].paused)).toBe(true);
  await expect(page.locator('#status-text')).toContainText('(muted)');
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await page.locator('[data-sound="prrr"]').click();
  await expect.poll(() => page.evaluate(() => window.testSounds.starts)).toBe(2);
});

test('all number shortcuts work after interacting with the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mute sound' }).click();
  for (const [key, name] of [['1', 'mjav'], ['2', 'prrrrt'], ['3', 'blep'], ['4', 'YAP YAP'], ['5', 'eepy'], ['6', 'space cat'], ['7', 'honk'], ['8', 'bonk'], ['9', 'boing'], ['0', 'ascend']]) {
    await page.keyboard.press(key);
    await expect(page.locator('#status-text')).toContainText(name);
  }
  const status = await page.locator('#status-text').textContent();
  await page.keyboard.press('Control+1');
  await expect(page.locator('#status-text')).toHaveText(status);
});

test('arcade starts, switches games, and exposes room WebSocket state', async ({ page }) => {
  await page.goto('/#arcade');
  await page.getByRole('button', { name: 'play solo' }).click();
  await expect(page.locator('#game-overlay')).toBeHidden();
  await page.getByRole('button', { name: /Boing Boing/ }).click();
  await expect(page.locator('#game-title')).toHaveText('Boing Boing');
  await page.getByRole('button', { name: 'play solo' }).click();
  const room = await page.evaluate(async () => {
    const response = await fetch('/api/rooms', { method: 'POST' });
    return { status: response.status, data: await response.json() };
  });
  expect(room.status).toBe(201);
  expect(room.data.code).toMatch(/^[a-z0-9]{8}$/);
  const messages = await page.evaluate((code) => new Promise((resolve, reject) => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${code}`);
    const seen = [];
    const timer = setTimeout(() => { socket.close(); reject(new Error('room socket timed out')); }, 5000);
    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      seen.push(JSON.parse(event.data).type);
      if (seen.includes('welcome') && seen.includes('state')) {
        clearTimeout(timer); socket.close(); resolve(seen);
      }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('room socket failed')); };
  }), room.data.code);
  expect(messages).toEqual(expect.arrayContaining(['welcome', 'state']));
});

test('chaos stops with its button, Escape, and page visibility', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mute sound' }).click();
  const chaos = page.locator('#chaos-button');
  await chaos.click();
  await expect(chaos).toHaveAttribute('aria-pressed', 'true');
  await expect(chaos).toContainText('stop chaos');
  const initial = await page.locator('#status-text').textContent();
  await expect(page.locator('#status-text')).not.toHaveText(initial);
  await chaos.click();
  await expect(chaos).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#status-text')).toHaveText('chaos contained (for now)');
  await page.waitForTimeout(850);
  await expect(page.locator('#status-text')).toHaveText('chaos contained (for now)');
  await chaos.click();
  await page.keyboard.press('Escape');
  await expect(chaos).toHaveAttribute('aria-pressed', 'false');
  await chaos.click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(chaos).toHaveAttribute('aria-pressed', 'false');
});

test('reduced motion disables loops and shows feedback without movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await page.locator('[data-sound="blep"]').click();
  await expect(page.locator('#status-text')).toContainText('blep');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('real meow and controls still work without Web Audio', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.AudioContext = undefined; window.webkitAudioContext = undefined; });
  await page.goto('/');
  await page.locator('#cat-button').click();
  await expect.poll(() => page.evaluate(() => window.testSounds.media[0].paused)).toBe(false);
  await page.locator('[data-sound="blep"]').click();
  await expect(page.locator('#status-text')).toContainText('blep');
  expect(errors).toEqual([]);
});
