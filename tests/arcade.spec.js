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
          if (data.type === 'frame' && window.roomState) window.roomState.world = data.world;
          if (data.type === 'reaction') {
            (window.reactions ||= []).push(data);
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
  await page.locator('#practice-solo').click();
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
  await page.locator('#practice-solo').click();
  await page.locator('[data-game="jump"]').click();
  await expect(page.locator('#best-score')).toHaveText(best);
});

async function connected(page) {
  await expect.poll(() => page.evaluate(() => window.roomState?.players.some((cat) => cat.id === window.catId))).toBe(true);
  return page.evaluate(() => window.catId);
}

test('everyone auto-joins one lobby, shares sounds, opts into listening, and echoes', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(60000);
  const errors = [];
  const guest = await context.newPage();
  const late = await context.newPage();
  for (const tab of [page, guest, late]) tab.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    const senderId = await connected(page);
    // Obsolete invite codes cannot split visitors into different rooms.
    const guestURL = new URL(baseURL).hostname === 'mjavmjav.com' ? 'https://www.mjavmjav.com/?room=oldcodes' : '/?room=oldcodes';
    await guest.goto(guestURL);
    const guestId = await connected(guest);
    await expect.poll(() => page.evaluate((id) => window.roomState.players.some((p) => p.id === id), guestId)).toBe(true);
    expect(await guest.evaluate(() => location.search)).toBe('');
    expect(await page.evaluate(() => window.roomState.lobby)).toBe('global');
    await expect(page.locator('#join-code, #create-room, #invite-link')).toHaveCount(0);
    expect(await guest.evaluate(() => window.audioStarts)).toBe(0);
    await page.locator('[data-sound="honk"]').click();
    await expect.poll(() => guest.evaluate((id) => window.reactions?.some((r) => r.id === id && r.sound === 'honk'), senderId)).toBe(true);
    await expect(guest.locator('#sound-stage-list')).toContainText('honk');
    expect(await guest.evaluate(() => window.audioStarts)).toBe(0);
    await guest.locator('#room-audio').check();
    const audible = await guest.evaluate(() => window.audioStarts);
    await page.waitForTimeout(800);
    await page.locator('[data-sound="ufo"]').click();
    await expect.poll(() => guest.evaluate(() => window.audioStarts)).toBeGreaterThan(audible);
    await page.waitForTimeout(800);
    expect(await guest.evaluate((id) => window.reactions.filter((r) => r.id === id).length, senderId)).toBe(2);
    expect(await page.evaluate((id) => (window.reactions || []).filter((r) => r.id === id).length, guestId)).toBe(0);
    await guest.locator('#sound-stage-list button').filter({ hasText: 'echo' }).first().click();
    await expect.poll(() => page.evaluate((id) => window.reactions.some((r) => r.id === id), guestId)).toBe(true);
    // Joining gets bounded history but never replays it as audio.
    await late.goto('/');
    await connected(late);
    await expect(late.locator('#sound-stage-list')).toContainText('ufo');
    expect(await late.evaluate(() => window.audioStarts)).toBe(0);
    await guest.locator('#mute-button').click();
    const muted = await guest.evaluate(() => window.audioStarts);
    await page.waitForTimeout(800);
    await page.locator('[data-sound="bonk"]').click();
    await expect.poll(() => guest.evaluate((id) => window.reactions.some((r) => r.id === id && r.sound === 'bonk'), senderId)).toBe(true);
    expect(await guest.evaluate(() => window.audioStarts)).toBe(muted);
    await page.locator('#arcade').screenshot({ path: testInfo.outputPath('global-lobby.png') });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await guest.close(); await late.close(); }
});

test('global races accept queued cats only, preserve spectators, and run both games without a host', async ({ page, context }) => {
  test.skip(Boolean(process.env.SITE_URL), 'Race sequencing is local-only: do not take over the live global game.');
  test.setTimeout(60000);
  const guest = await context.newPage();
  const late = await context.newPage();
  try {
    await page.goto('/'); await connected(page);
    await guest.goto('/'); await connected(guest);
    await expect(page.locator('#room-count')).toHaveText('2 cats online');
    // An unqueued spectator cannot start a race or submit their own score.
    await guest.evaluate(() => {
      window.roomSocket.send(JSON.stringify({ type: 'start', mode: 'jump' }));
      window.roomSocket.send(JSON.stringify({ type: 'score', score: 999999 }));
    });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.roomState.world)).toBeNull();
    await page.locator('#room-queue').click();
    await guest.locator('#room-queue').click();
    await expect(guest.locator('#room-start')).toBeEnabled();
    // The newest visitor can start; the oldest one has no special privileges.
    await guest.locator('#room-start').click();
    await expect.poll(() => page.evaluate(() => window.roomState.world?.phase)).toBe('countdown');
    await late.goto('/'); await connected(late);
    await expect(late.locator('#game-state')).toContainText('spectating');
    expect(await late.evaluate(() => scrollY)).toBe(0);
    expect(await late.evaluate(() => window.roomState.world.players.some((cat) => cat.id === window.catId))).toBe(false);
    await expect(page.locator('#game-title')).toHaveText('outplayed by a vegetable.', { timeout: 10000 });
    await expect(guest.locator('#game-title')).toHaveText('outplayed by a vegetable.');
    expect(await page.evaluate(() => window.roomState.world.players.map((cat) => cat.score)))
      .toEqual(await guest.evaluate(() => window.roomState.world.players.map((cat) => cat.score)));
    await page.locator('#practice-solo').click();
    await page.locator('#pause-game').click();
    await guest.locator('[data-game="jump"]').click();
    await guest.locator('#room-queue').click();
    await late.locator('#room-queue').click();
    await guest.locator('#room-start').click();
    await expect.poll(() => late.evaluate(() => window.roomState.world?.mode)).toBe('jump');
    await expect.poll(() => late.evaluate(() => window.roomState.world?.phase)).toBe('playing');
    await expect(page.locator('#game-state')).toContainText('paused');
    expect(await page.evaluate(() => window.roomState.world.players.some((cat) => cat.id === window.catId))).toBe(false);
    await guest.locator('#steer-right').dispatchEvent('pointerdown', { pointerId: 1 });
    await expect.poll(() => guest.evaluate(() => window.roomState.world.players.find((cat) => cat.id === window.catId)?.x)).toBeGreaterThan(240);
    await guest.locator('#steer-right').dispatchEvent('pointerup', { pointerId: 1 });
  } finally { await guest.close(); await late.close(); }
});

test('more than eight visitors connect, eight race, and the waiting cat gets the next seat', async ({ page }) => {
  test.skip(Boolean(process.env.SITE_URL), 'Capacity and race sequencing use the local global lobby only.');
  await page.goto('/'); await connected(page);
  const result = await page.evaluate(async () => {
    const sockets = [];
    let state;
    const waitFor = (check) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('global state timeout')); }, 10000);
      const timer = setInterval(() => { if (check()) { clearInterval(timer); clearTimeout(timeout); resolve(); } }, 30);
    });
    const open = () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/room`);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'welcome') ws.catId = data.id;
        if (data.type === 'state') { state = data; resolve(ws); }
        if (data.type === 'frame' && state) state.world = data.world;
      };
      ws.onerror = reject;
    });
    try {
      for (let i = 0; i < 10; i++) sockets.push(await open());
      const connected = state.players.length;
      for (let i = 0; i < 9; i++) {
        sockets[i].send(JSON.stringify({ type: 'queue', join: true }));
        await waitFor(() => state.queue.length === i + 1);
      }
      sockets[0].send(JSON.stringify({ type: 'start', mode: 'flappy' }));
      await waitFor(() => state.world?.phase === 'countdown');
      const racers = state.world.players.length;
      const queue = [...state.queue];
      const spectatorsDrafted = state.world.players.some((p) => p.id === sockets[9].catId);
      const uniqueColors = new Set(state.world.players.map((p) => p.color)).size;
      await waitFor(() => state.world?.phase === 'over');
      sockets[8].send(JSON.stringify({ type: 'start', mode: 'flappy' }));
      await waitFor(() => state.world?.phase === 'countdown');
      return { connected, racers, queue, waiting: sockets[8].catId, spectatorsDrafted, uniqueColors, next: state.world.players.map((p) => p.id) };
    } finally { for (const ws of sockets) ws.close(1000, 'Test complete'); }
  });
  expect(result.connected).toBe(11);
  expect(result.racers).toBe(8);
  expect(result.uniqueColors).toBe(8);
  expect(result.spectatorsDrafted).toBe(false);
  expect(result.queue).toEqual([result.waiting]);
  expect(result.next).toEqual([result.waiting]);
});

test('disconnects reconnect to the global lobby and APIs reject foreign origins and old rooms', async ({ page, request, baseURL }) => {
  await page.goto('/');
  const previous = await connected(page);
  const foreign = await request.get('/api/room', { headers: { Origin: 'https://some-other-cat.example' } });
  expect(foreign.status()).toBe(403);
  const old = await request.post('/api/rooms', { headers: { Origin: new URL(baseURL).origin } });
  expect(old.status()).toBe(404);
  const missingUpgrade = await request.get('/api/room', { headers: { Origin: new URL(baseURL).origin } });
  expect(missingUpgrade.status()).toBe(426);
  await page.evaluate(() => window.roomSocket.close(1000, 'Reconnect test'));
  await expect.poll(() => page.evaluate(() => window.catId)).not.toBe(previous);
  await connected(page);
  expect(await page.evaluate((id) => window.roomState.players.some((p) => p.id === id), previous)).toBe(false);
  expect(await page.evaluate(() => window.roomState.lobby)).toBe('global');
});

test('the global sound stage rate-limits spam and rejects malformed messages', async ({ page }) => {
  test.skip(Boolean(process.env.SITE_URL), 'Spam probes are local-only.');
  await page.goto('/'); await connected(page);
  await page.waitForTimeout(750);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.roomSocket.send(JSON.stringify({ type: 'reaction', sound: 'honk' }));
  });
  await expect.poll(() => page.evaluate(() => window.reactionCount)).toBe(1);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.reactionCount)).toBe(1);
  await expect(page.locator('#room-status')).toContainText('Tiny breath');
  const closed = await page.evaluate(() => new Promise((resolve) => {
    window.roomSocket.addEventListener('close', (event) => resolve(event.code), { once: true });
    window.roomSocket.send('{not-cat-json');
  }));
  expect(closed).toBe(1008);
});
