import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.audioStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.audioStarts += 1;
      return start.apply(this, args);
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        window.roomSocket = this;
        this.addEventListener('message', (event) => {
          if (event.data === 'pong') return;
          const data = JSON.parse(event.data);
          if (data.type === 'welcome') window.catId = data.id;
          if (data.type === 'state') window.roomState = data;
          if (data.type === 'reaction') {
            window.lastReaction = data;
            window.reactionCount = (window.reactionCount || 0) + 1;
          }
        });
      }
    };
  });
});

test('solo controls, pause, rematch, and personal best work in both games', async ({ page }) => {
  await page.goto('/#arcade');
  await page.locator('#solo-start').click();
  await page.locator('#pause-game').click();
  await expect(page.locator('#game-state')).toContainText('paused');
  await page.waitForTimeout(1000);
  await expect(page.locator('#game-overlay')).toBeHidden();
  await page.locator('#pause-game').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#pause-game')).toHaveText('pause');
  await page.locator('#flap-control').dispatchEvent('pointerdown');
  await expect.poll(() => page.evaluate(() => window.audioStarts)).toBeGreaterThan(2);
  await expect(page.locator('#game-title')).toHaveText('outplayed by a vegetable.', { timeout: 6000 });
  await page.locator('#solo-start').click();
  await expect(page.locator('#game-overlay')).toBeHidden();
  await page.locator('[data-game="jump"]').click();
  await page.locator('#solo-start').click();
  await expect(page.locator('#steer-controls')).toBeVisible();
  await expect(page.locator('#flap-control')).toBeHidden();
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => Number(await page.locator('#current-score').textContent())).toBeGreaterThan(0);
  await page.keyboard.up('ArrowRight');
  await page.locator('#pause-game').click();
  const best = await page.locator('#best-score').textContent();
  expect(Number(best)).toBeGreaterThan(0);
  await page.reload();
  await page.locator('[data-game="jump"]').click();
  await expect(page.locator('#best-score')).toHaveText(best);
});

test('friends race both games, late join, share sounds, and inherit the host', async ({ page, context }, testInfo) => {
  const errors = [];
  const guest = await context.newPage();
  const late = await context.newPage();
  for (const tab of [page, guest, late]) tab.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/#arcade');
    await page.locator('#create-room').click();
    await expect(page.locator('#room-count')).toHaveText('1/8 cats');
    const link = await page.locator('#invite-link').inputValue();
    await guest.goto(link);
    await guest.locator('#join-room').click();
    await expect(page.locator('#room-count')).toHaveText('2/8 cats');
    await page.locator('#arcade').screenshot({ path: testInfo.outputPath('connected-room.png') });
    await expect(guest.locator('#room-start')).toBeHidden();
    await expect(guest.locator('[data-game="jump"]')).toBeDisabled();
    const quiet = await guest.evaluate(() => window.audioStarts);
    await page.locator('[data-sound="honk"]').click();
    await expect(guest.locator('#room-reaction')).toContainText('honk!');
    expect(await guest.evaluate(() => window.audioStarts)).toBe(quiet);
    await guest.locator('#room-audio').check();
    const audible = await guest.evaluate(() => window.audioStarts);
    await page.waitForTimeout(650);
    await page.locator('[data-sound="ufo"]').click();
    await expect.poll(() => guest.evaluate(() => window.audioStarts)).toBe(audible + 2);
    await page.waitForTimeout(750);
    expect(await guest.evaluate(() => window.reactionCount)).toBe(2);
    expect(await page.evaluate(() => window.reactionCount)).toBe(2);
    // A guest cannot start a race or submit a score, even by bypassing the UI.
    await guest.evaluate(() => {
      window.roomSocket.send(JSON.stringify({ type: 'start', mode: 'jump' }));
      window.roomSocket.send(JSON.stringify({ type: 'score', score: 999999 }));
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.roomState.world)).toBeNull();
    await page.locator('#room-start').click();
    await expect.poll(() => guest.evaluate(() => window.roomState.world?.phase)).toBe('countdown');
    await late.goto(link);
    await late.locator('#join-room').click();
    await expect(late.locator('#game-title')).toHaveText('front-row cat seat.');
    expect(await late.evaluate(() => window.roomState.world.players.some((cat) => cat.id === window.catId))).toBe(false);
    await expect(page.locator('#room-start')).toBeEnabled({ timeout: 10000 });
    await expect(guest.locator('#game-title')).toHaveText('outplayed by a vegetable.');
    expect(await page.evaluate(() => window.roomState.world.players.map((cat) => cat.score)))
      .toEqual(await guest.evaluate(() => window.roomState.world.players.map((cat) => cat.score)));
    await page.locator('#room-leave').click();
    await expect(guest.locator('#room-start')).toBeVisible();
    await expect(guest.locator('#room-count')).toHaveText('2/8 cats');
    await guest.locator('[data-game="jump"]').click();
    await guest.locator('#room-start').click();
    await expect.poll(() => late.evaluate(() => window.roomState.world?.mode)).toBe('jump');
    await expect.poll(() => late.evaluate(() => window.roomState.world?.phase)).toBe('playing');
    expect(await late.evaluate(() => window.roomState.world.players.some((cat) => cat.id === window.catId))).toBe(true);
    await guest.locator('#steer-right').dispatchEvent('pointerdown', { pointerId: 1 });
    await expect.poll(() => guest.evaluate(() => window.roomState.world.players.find((cat) => cat.id === window.catId)?.x)).toBeGreaterThan(240);
    await guest.locator('#steer-right').dispatchEvent('pointerup', { pointerId: 1 });
    const overflow = await guest.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width })));
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await late.close();
  }
});

test('rooms cap at eight and reject malformed messages and origins', async ({ page, request, baseURL }) => {
  await page.goto('/#arcade');
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/rooms', { method: 'POST' });
    return response.json();
  });
  const foreign = await request.post('/api/rooms', { headers: { Origin: 'https://some-other-cat.example' } });
  expect(foreign.status()).toBe(403);
  const missing = await request.get('/api/rooms/zzzzzzzz', { headers: { Origin: new URL(baseURL).origin } });
  expect(missing.status()).toBe(404);
  const result = await page.evaluate(async (code) => {
    const sockets = [];
    const open = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${code}`);
      ws.onmessage = (event) => { if (JSON.parse(event.data).type === 'state') resolve(ws); };
      ws.onerror = reject;
    });
    try {
      for (let index = 0; index < 8; index++) sockets.push(await open());
      const rejected = await new Promise((resolve) => {
        const ninth = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${code}`);
        ninth.onopen = () => { ninth.close(); resolve(false); };
        ninth.onerror = () => resolve(true);
      });
      const invalid = await new Promise((resolve) => {
        sockets[0].onclose = (event) => resolve(event.code);
        sockets[0].send('{not-cat-json');
      });
      return { rejected, invalid, count: sockets.length };
    } finally { for (const ws of sockets) ws.close(1000, 'Test complete'); }
  }, created.code);
  expect(result).toEqual({ rejected: true, invalid: 1008, count: 8 });
});
