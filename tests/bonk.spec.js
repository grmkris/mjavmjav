import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args); window.roomSocket = this;
        this.addEventListener('message', (event) => {
          if (event.data === 'pong') return;
          const data = JSON.parse(event.data);
          if (data.type === 'welcome') window.catId = data.id;
          if (data.type === 'state') window.roomState = data;
          if (data.type === 'frame' && window.roomState) window.roomState.world = data.world;
          if (data.world?.mode === 'bonk' && data.world.turnPhase === 'reveal') (window.bonkReveals ||= {})[data.world.turn] = data.world;
          if (data.type === 'plan-ack') (window.planAcks ||= []).push(data);
          if (data.world?.mode === 'bonk' && 'plans' in data.world) window.leakedPlan = true;
          if (data.world?.mode === 'bonk' && data.world.turn === 1 && data.world.turnPhase === 'plan' && data.world.players.length === 2) {
            if (data.world.players[0].cell !== 0 || data.world.players[1].cell !== 35 || data.world.blasts.length) window.earlyReveal = true;
          }
        });
      }
      send(data) {
        if (window.planDelay && typeof data === 'string' && data.startsWith('{') && JSON.parse(data).type === 'plan') {
          setTimeout(() => super.send(data), window.planDelay); return;
        }
        super.send(data);
      }
    };
  });
});

async function connect(page) {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.roomState?.players.some((p) => p.id === window.catId)))).toBe(true);
}
const tile = (page, cell) => page.locator(`#bonk-map [data-cell="${cell}"]`);

async function submitPlan(page, move, target, turn) {
  // UI input is exercised in bot practice. Drive the multiplayer protocol directly
  // so two browser tabs do not compete for focus during an eight-second deadline.
  await page.evaluate(({ move, target, turn }) => {
    const world = window.roomState.world;
    if (world.turn !== turn || world.turnPhase !== 'plan') throw new Error('Missed the test planning window');
    window.roomSocket.send(JSON.stringify({ type: 'plan', round: world.round, turn, move, target }));
  }, { move, target, turn });
  await expect.poll(() => page.evaluate((turn) => window.planAcks?.some((ack) => ack.accepted && ack.turn === turn), turn)).toBe(true);
  await expect(page.locator('#bonk-lock')).toHaveText('plan locked ✓');
}

test('Bonk bot practice has usable map targets, keyboard plans, pause and reveal', async ({ page }, testInfo) => {
  test.setTimeout(40000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  // Practice remains available even if visitors are playing a different live game.
  await page.locator('#practice-solo').click();
  await page.locator('[data-game="bonk"]').click();
  await expect(page.locator('#solo-start')).toHaveText('practice vs bots');
  await page.locator('#solo-start').click();
  await expect(page.locator('#bonk-map button')).toHaveCount(36);
  await expect(page.locator('#bonk-cats')).toContainText('Bot Sardine');
  await expect(page.locator('#bonk-cats')).toContainText('Bot Loaf');
  const targets = await page.locator('#bonk-map button').evaluateAll((buttons) => buttons.map((button) => {
    const { width, height } = button.getBoundingClientRect(); return { width, height };
  }));
  expect(targets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);
  await page.locator('#pause-game').click();
  await expect(page.locator('#bonk-status')).toContainText('Cat nap');
  await expect(page.locator('#bonk-lock')).toBeDisabled();
  await page.waitForTimeout(1100);
  await expect(page.locator('#bonk-status')).toContainText('Cat nap');
  await page.locator('#pause-game').click();
  await tile(page, 35).click();
  await expect(page.locator('#bonk-plan')).toContainText('Tiny legs');
  await tile(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tile(page, 1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#bonk-plan')).toContainText('Move to B1');
  await page.locator('#bonk-throw').click();
  await tile(page, 35).click();
  await expect(page.locator('#bonk-plan')).toContainText('fish at F6');
  await page.locator('#bonk-lock').click();
  await expect(page.locator('#bonk-lock')).toHaveText('plan locked ✓');
  await expect(page.locator('#bonk-lock')).toBeDisabled();
  await page.locator('.game-viewport').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('bonk-practice.png') });
  await expect(page.locator('#bonk-status')).toHaveText('The fish have landed.', { timeout: 12000 });
  await expect(page.locator('#bonk-status')).toContainText('Turn 2/8', { timeout: 5000 });
  await expect(page.locator('#bonk-lock')).toBeEnabled();
  await page.locator('#bonk-shield').click();
  await page.locator('#bonk-lock').click();
  await expect(page.locator('#bonk-plan')).toContainText('Plan locked');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Bonk waits for a rival, keeps delayed plans private, and resolves human combat together', async ({ page, context }, testInfo) => {
  test.skip(Boolean(process.env.SITE_URL), 'PvP combat uses the local global room, never interrupts live players.');
  test.setTimeout(65000);
  const guest = await context.newPage(), spectator = await context.newPage();
  const errors = [];
  for (const tab of [page, guest, spectator]) tab.on('pageerror', (error) => errors.push(error.message));
  try {
    await connect(page); await connect(guest); await connect(spectator);
    await page.locator('[data-game="bonk"]').click();
    await page.locator('#quick-play').click();
    await expect(page.locator('#quick-play')).toHaveText('waiting for a rival…');
    expect(await page.evaluate(() => window.roomState.world)).toBeNull();
    await expect(guest.locator('#quick-play')).toHaveText('join the catfight');
    await expect(spectator.locator('[data-game="bonk"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#room-queue').click();
    await expect.poll(() => guest.evaluate(() => window.roomState.waitingMode)).toBeNull();
    await page.locator('#quick-play').click();
    await guest.locator('#quick-play').click();
    await expect.poll(() => page.evaluate(() => window.roomState.world?.phase)).toBe('countdown');
    expect(await page.evaluate(() => window.roomState.world.players.some((cat) => cat.bot))).toBe(false);
    await expect.poll(() => page.evaluate(() => window.roomState.world?.phase), { timeout: 10000, intervals: [100] }).toBe('playing');
    await expect(spectator.locator('#bonk-lock')).toBeDisabled();
    await expect(spectator.locator('#bonk-plan')).toContainText('play next round');
    // A deliberately delayed client still has the same whole turn to plan.
    await page.evaluate(() => { window.planDelay = 600; });
    await Promise.all([submitPlan(page, 1, 35, 1), submitPlan(guest, 34, 0, 1)]);
    expect(await page.evaluate(() => window.planAcks.some((ack) => ack.accepted && ack.turn === 1))).toBe(true);
    expect(await guest.evaluate(() => window.planAcks.some((ack) => ack.accepted && ack.turn === 1))).toBe(true);
    await page.locator('.game-viewport').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('bonk-pvp-planning.png') });
    await expect.poll(() => page.evaluate(() => Boolean(window.bonkReveals?.[1])), { timeout: 10000, intervals: [100] }).toBe(true);
    const reveal = await page.evaluate(() => window.bonkReveals[1]);
    expect(reveal.players.map(({ cell, hp, score }) => ({ cell, hp, score }))).toEqual([{ cell: 1, hp: 2, score: 1 }, { cell: 34, hp: 2, score: 1 }]);
    expect(reveal.blasts).toHaveLength(2);
    await expect.poll(() => guest.evaluate(() => window.roomState.world.players.map((cat) => cat.hp))).toEqual([2, 2]);
    await page.screenshot({ path: testInfo.outputPath('bonk-pvp-reveal.png') });
    await expect.poll(() => page.evaluate(() => window.roomState.world.turn), { timeout: 5000 }).toBe(2);
    await Promise.all([submitPlan(page, 2, null, 2), submitPlan(guest, 34, 2, 2)]);
    await expect.poll(() => page.evaluate(() => Boolean(window.bonkReveals?.[2])), { timeout: 10000, intervals: [100] }).toBe(true);
    const shielded = await page.evaluate(() => window.bonkReveals[2]);
    expect(shielded.players[0].hp).toBe(2);
    expect(shielded.players[0].shields).toBe(1);
    expect(shielded.events.join(' ')).toContain('suspicious plate');
    for (const tab of [page, guest, spectator]) {
      expect(await tab.evaluate(() => Boolean(window.leakedPlan))).toBe(false);
      expect(await tab.evaluate(() => Boolean(window.earlyReveal))).toBe(false);
    }
    await page.evaluate(() => window.roomSocket.send(JSON.stringify({ type: 'retire' })));
    await expect.poll(() => guest.evaluate(() => window.roomState.world.phase), { timeout: 5000 }).toBe('over');
    await expect(guest.locator('#game-title')).toHaveText('you won the catfight.');
    expect(errors).toEqual([]);
  } finally { await guest.close(); await spectator.close(); }
});
