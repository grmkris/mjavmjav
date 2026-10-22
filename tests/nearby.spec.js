import { test, expect } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  test.skip(Boolean(process.env.SITE_URL), 'Nearby pairing and disconnect probes stay local.');
  await context.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.nearbyPeers = []; window.nearbyMessages = []; window.nearbyChannels = [];
    function observe(channel) {
      window.nearbyChannels.push(channel);
      channel.addEventListener('message', ({ data }) => { try { window.nearbyMessages.push(JSON.parse(data)); } catch {} });
    }
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config) { super(config); window.nearbyPeers.push(this); this.addEventListener('datachannel', ({ channel }) => observe(channel)); }
      createDataChannel(...args) { const channel = super.createDataChannel(...args); observe(channel); return channel; }
    };
  });
});
async function load(page) {
  await page.goto('/nearby');
  await expect(page.locator('#offline-ready')).toContainText('Saved for offline play');
  await page.waitForFunction(() => navigator.serviceWorker.controller);
}
async function scanQR(source, target) {
  // Decode at the displayed phone size, rather than feeding the scanner a pristine full-resolution matrix.
  const image = 'data:image/png;base64,' + (await source.locator('#pair-qr').screenshot()).toString('base64');
  await target.evaluate(async (url) => {
    const image = new Image(); image.src = url; await image.decode();
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints.audio !== false) throw new Error('Unexpected microphone request');
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const stream = canvas.captureStream(5); window.testCamera = stream;
      return stream;
    };
  }, image);
  await target.locator('#scan-code').click();
}
async function pair(host, guest, qr = true) {
  await host.locator('#make-code').click();
  await expect(host.locator('#qr-panel')).toBeVisible();
  if (qr) await scanQR(host, guest);
  else { await guest.locator('#text-pairing summary').click(); }
  if (!qr) {
    await guest.locator('#in-code').fill(await host.locator('#out-code').inputValue());
    await guest.locator('#use-code').click();
  }
  await expect(guest.locator('#qr-panel')).toBeVisible();
  if (qr) await scanQR(guest, host);
  else {
    await host.locator('#text-pairing summary').click();
    await host.locator('#in-code').fill(await guest.locator('#out-code').inputValue());
    await host.locator('#use-code').click();
  }
  for (const page of [host, guest]) await expect(page.locator('#pair-status')).toHaveText('Two nearby cats connected.', { timeout: 30000 });
}
async function lock(page, target) {
  await page.locator('#bonk-throw').click();
  await page.locator(`#bonk-map button[data-cell="${target}"]`).click();
  await page.locator('#bonk-lock').click();
  await expect(page.locator('#bonk-lock')).toHaveText('plan locked ✓');
}

test('cached offline phones scan both QR codes, play a full Bonk session, and pair again after a drop', async ({ page: host, context }, testInfo) => {
  test.setTimeout(160000);
  const guest = await context.newPage(); const errors = [];
  for (const page of [host, guest]) page.on('pageerror', (error) => errors.push(error.message));
  await load(host); await load(guest);
  await context.setOffline(true);
  await host.reload(); await guest.reload();
  for (const page of [host, guest]) await expect(page.locator('#make-code')).toBeVisible();
  // Chromium disables host ICE candidates while its context is offline; the production path has no STUN/TURN.
  // Assets have already been proven cacheable above, so re-enable the browser transport for loopback WebRTC.
  await context.setOffline(false);
  await context.route('**/*', (route) => route.abort());
  const start = Date.now(); await pair(host, guest);
  expect(Date.now() - start).toBeLessThan(30000);
  for (const page of [host, guest]) {
    expect(await page.evaluate(() => window.nearbyPeers.at(-1).getConfiguration().iceServers)).toEqual([]);
    expect(await page.evaluate(() => window.testCamera.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  }
  await host.locator('#nearby-play').click();
  await expect(host.locator('#round-status')).toContainText('Waiting for the other cat');
  await guest.locator('#nearby-play').click();
  for (let turn = 1; turn <= 3; turn++) {
    await expect(host.locator('#bonk-status')).toContainText(`Turn ${turn}/8`, { timeout: 12000 });
    await lock(host, 35); await lock(guest, 0);
    if (turn === 1) {
      const messages = await guest.evaluate(() => window.nearbyMessages.filter((m) => m.type === 'world'));
      expect(messages.every((m) => !('plans' in m.world) && m.world.blasts.length === 0)).toBe(true);
      await host.locator('#nearby-arena').scrollIntoViewIfNeeded();
      await host.screenshot({ path: testInfo.outputPath('nearby-playing.png') });
      const tiles = await host.locator('#bonk-map button').evaluateAll((buttons) => buttons.map((button) => { const box = button.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
      expect(tiles.every((box) => box.width >= 44 && box.height >= 44)).toBe(true);
    }
    await expect(host.locator('#bonk-status')).toHaveText('The fish have landed.', { timeout: 12000 });
  }
  for (const page of [host, guest]) {
    await expect(page.locator('#round-status')).toContainText('Round over.', { timeout: 6000 });
    await expect(page.locator('#round-status')).toContainText('Both cats got bonked!');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await host.locator('#nearby-play').click(); await guest.locator('#nearby-play').click();
  await expect(host.locator('#round-status')).toContainText('Starting in');
  // Simulate a silent transport black hole without a polite channel-close event.
  for (const page of [host, guest]) await page.evaluate(() => { window.nearbyChannels.at(-1).send = () => {}; });
  for (const page of [host, guest]) {
    await expect(page.locator('#pair-status')).toContainText('Connection dropped', { timeout: 12000 });
    await expect(page.locator('#bonk-lock')).toBeDisabled();
    await page.locator('#pair-again').click();
  }
  await pair(host, guest, false);
  await expect(host.locator('#nearby-play')).toBeEnabled(); await expect(guest.locator('#nearby-play')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('pairing errors, camera denial, keyboard controls, and phone QR layout remain usable', async ({ page }, testInfo) => {
  await load(page);
  await page.locator('#text-pairing summary').click();
  await page.locator('#in-code').fill('https://not-a-pairing-code.example'); await page.locator('#use-code').click();
  await expect(page.locator('#scan-status')).toContainText('Scan a nearby-play QR code');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await page.locator('#scan-code').click(); await expect(page.locator('#scan-status')).toContainText('Camera unavailable');
  await page.locator('#make-code').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#pair-qr')).toBeVisible();
  const qr = await page.locator('#pair-qr').boundingBox(); expect(qr.width).toBeGreaterThan(270); expect(qr.width).toBeLessThanOrEqual(390);
  expect(qr.y).toBeGreaterThanOrEqual(0); expect(qr.y + qr.height).toBeLessThanOrEqual(testInfo.project.use.viewport.height);
  await page.screenshot({ path: testInfo.outputPath('nearby-qr.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const heights = await page.locator('.pair-actions button:visible').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
  expect(heights.every((height) => height >= 44)).toBe(true);
});

test('a reply that never reaches the first phone times out with a recoverable pairing screen', async ({ page: host, context }) => {
  const guest = await context.newPage(); await load(host); await load(guest);
  await host.locator('#make-code').click(); await expect(host.locator('#pair-qr')).toBeVisible();
  await guest.locator('#text-pairing summary').click();
  await guest.locator('#in-code').fill(await host.locator('#out-code').inputValue());
  await guest.clock.install(); await guest.locator('#use-code').click();
  await expect(guest.locator('#qr-panel')).toBeVisible(); await guest.clock.fastForward(31000);
  await expect(guest.locator('#pair-status')).toContainText('Could not connect within 30 seconds');
  await guest.locator('#pair-again').click(); await expect(guest.locator('#make-code')).toBeVisible();
});
