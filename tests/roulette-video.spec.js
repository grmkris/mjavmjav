import { test, expect } from '@playwright/test';
import { rpc, call, register, connect, operationId } from './roulette-helpers.js';
const cam = (page, id) => page.locator(`[data-camera="${id}"]`);
const localOnly = () => test.skip(Boolean(process.env.SITE_URL), 'Synthetic camera and matchmaking checks run locally.');
async function action(ctx, base, action, args = {}) {
  const response = await ctx.request.post(`${base}/api/roulette`, { headers: { Origin: base }, data: { action, operationId: operationId(), ...args } });
  expect(response.ok()).toBe(true); return response.json();
}
async function pair(a, b, base) {
  await action(a, base, 'join'); const joined = await action(b, base, 'join');
  const matchId = joined.match.id;
  await action(a, base, 'accept', { matchId }); await action(b, base, 'accept', { matchId }); return matchId;
}
async function cleanup(contexts, base) {
  for (const ctx of contexts) {
    const state = await action(ctx, base, 'status');
    await action(ctx, base, 'leave', state.match ? { matchId: state.match.id } : {});
    await ctx.close();
  }
}
async function observe(context) {
  await context.addInitScript(() => {
    window.testTracks = []; window.testPeers = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await original(...args); window.testTracks.push(...stream.getTracks()); return stream; };
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.testPeers.push(this); } };
  });
}

test('two cameras exchange decoded frames; audio is opt-in; stop, rejoin and leave release every track', async ({ browser, baseURL }, testInfo) => {
  localOnly(); test.setTimeout(75_000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ ...testInfo.project.use, permissions: ['camera', 'microphone'] })));
  const [a, b] = contexts; await Promise.all(contexts.map(observe));
  try {
    const matchId = await pair(a, b, baseURL);
    const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));
    await Promise.all(pages.map((page) => page.goto(`${baseURL}/roulette`)));
    for (const page of pages) {
      expect(await page.evaluate(() => window.testTracks.length)).toBe(0);
      await cam(page, 'preview').click(); await expect(cam(page, 'share')).toBeVisible(); await expect(cam(page, 'share')).toBeEnabled();
      await expect.poll(() => page.evaluate(() => window.testTracks.map((t) => t.kind))).toEqual(['video']);
      expect(await page.evaluate(() => window.testPeers.length)).toBe(0);
      await cam(page, 'share').click();
    }
    for (const page of pages) {
      await expect(cam(page, 'status')).toContainText('video call', { timeout: 20_000 });
      try { await expect.poll(() => cam(page, 'remote').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(2); }
      catch (error) {
        for (const p of pages) console.log('Camera diagnostics', await p.evaluate(async () => {
          const pc = window.testPeers.at(-1), video = document.querySelector('[data-camera="remote"]');
          const stats = [...(await pc.getStats()).values()].filter((s) => ['inbound-rtp', 'outbound-rtp', 'media-source'].includes(s.type));
          return { state: pc.connectionState, stats, transceivers: pc.getTransceivers().map((t) => ({ direction: t.currentDirection, send: t.sender.track?.kind, recv: t.receiver.track?.kind })), video: { paused: video.paused, readyState: video.readyState, width: video.videoWidth, tracks: video.srcObject?.getTracks().map((t) => ({ kind: t.kind, muted: t.muted, state: t.readyState })) } };
        }));
        throw error;
      }
      expect(await page.evaluate(() => window.testPeers.at(-1).getSenders().filter((s) => s.track?.kind === 'audio').length)).toBe(0);
    }
    for (const index of [0, 1]) {
      await cam(pages[index], 'mic').click(); await expect(cam(pages[index], 'mic')).toHaveText('mute mic');
      await expect.poll(() => pages[1 - index].evaluate(async () => {
        const stats = await window.testPeers.at(-1).getStats(); return [...stats.values()].find((s) => s.type === 'inbound-rtp' && s.kind === 'audio')?.bytesReceived || 0;
      })).toBeGreaterThan(0);
      await cam(pages[index], 'mic').click();
      expect(await pages[index].evaluate(() => window.testTracks.filter((t) => t.kind === 'audio').every((t) => t.readyState === 'ended'))).toBe(true);
    }
    expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pages[0].screenshot({ path: testInfo.outputPath('loaf-cam-connected.png'), fullPage: true });
    await cam(pages[0], 'stop').click();
    expect(await pages[0].evaluate(() => window.testTracks.every((t) => t.readyState === 'ended'))).toBe(true);
    await expect(cam(pages[1], 'status')).toContainText('Waiting', { timeout: 7000 });
    await cam(pages[0], 'preview').click(); await cam(pages[0], 'share').click();
    await expect(cam(pages[0], 'status')).toContainText('video call', { timeout: 15_000 });
    await action(a, baseURL, 'leave', { matchId });
    for (const page of pages) await expect.poll(() => page.evaluate(() => window.testTracks.every((t) => t.readyState === 'ended')), { timeout: 8000 }).toBe(true);
  } finally { await cleanup(contexts, baseURL); }
});

test('MCP camera capability is hidden from model state and works in a cookie-free browser fallback', async ({ browser, request, baseURL }, testInfo) => {
  localOnly(); test.setTimeout(60_000);
  const a = await browser.newContext(), b = await browser.newContext(), fallback = await browser.newContext({ ...testInfo.project.use, permissions: ['camera', 'microphone'] });
  try {
    const client = await register(request, baseURL), auth = await connect(a.request, baseURL, client);
    const matchId = await pair(a, b, baseURL);
    const result = await call(a.request, baseURL, auth.access_token, 'roulette_camera', { matchId, sessionId: crypto.randomUUID() });
    expect(result.isError).toBeUndefined(); expect(result._meta.camera.token).toHaveLength(64);
    expect(JSON.stringify(result.content)).not.toContain(result._meta.camera.token);
    const state = await call(a.request, baseURL, auth.access_token, 'roulette_status');
    expect(JSON.stringify(state)).not.toContain(result._meta.camera.token);
    const grant = result._meta.camera;
    const page = await fallback.newPage(); await observe(fallback);
    await page.goto(`${baseURL}/roulette-camera#${new URLSearchParams({ token: grant.token, session: grant.sessionId, match: matchId, expires: String(grant.expires) })}`);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
    await cam(page, 'preview').click(); await cam(page, 'share').click();
    await expect(cam(page, 'status')).toContainText('Waiting');
    const bad = await request.post(`${baseURL}/api/roulette-camera`, { data: { action: 'poll' } }); expect(bad.status()).toBe(401);
    await action(b, baseURL, 'leave', { matchId });
    await expect(cam(page, 'status')).toContainText('ended', { timeout: 8000 });
    expect(await page.evaluate(() => window.testTracks.every((t) => t.readyState === 'ended'))).toBe(true);
    expect((await request.post(`${baseURL}/api/roulette-camera`, { headers: { Authorization: `Bearer ${grant.token}` }, data: { action: 'config' } })).status()).toBe(400);
    await fallback.close();
  } finally { await cleanup([a, b], baseURL); }
});

test('camera permission failure stays usable, and cancelling a pending permission never starts capture later', async ({ page, baseURL }) => {
  localOnly();
  await page.goto(`${baseURL}/roulette`);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  await cam(page, 'preview').click(); await expect(cam(page, 'status')).toContainText('blocked');
  await expect(cam(page, 'preview')).toBeEnabled();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { window.resolveCamera = resolve; }); });
  await cam(page, 'preview').click(); await cam(page, 'stop').click();
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); const stream = canvas.captureStream(5);
    window.lateTrack = stream.getVideoTracks()[0]; window.resolveCamera(stream);
  });
  await expect.poll(() => page.evaluate(() => window.lateTrack.readyState)).toBe('ended');
  await expect(cam(page, 'share')).toBeHidden();
});

test('embedded host camera permission and external-link fallback use the same match', async ({ browser, request, baseURL }) => {
  localOnly(); test.setTimeout(60_000);
  const a = await browser.newContext({ permissions: ['camera'] }), b = await browser.newContext();
  try {
    const client = await register(request, baseURL), auth = await connect(a.request, baseURL, client);
    const matchId = await pair(a, b, baseURL);
    const resource = await (await rpc(request, baseURL, 'resources/read', { uri: 'ui://mjavmjav/roulette-v2.html' })).json();
    const page = await a.newPage();
    await page.exposeFunction('cameraTool', ({ name, arguments: args }) => call(a.request, baseURL, auth.access_token, name.replace(/^cats_/, ''), args));
    await page.route(`${baseURL}/camera-host`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
    await page.goto(`${baseURL}/camera-host`);
    await page.evaluate((markup) => {
      const frame = document.createElement('iframe'); frame.id = 'widget'; frame.style.cssText = 'width:100%;height:1500px';
      frame.setAttribute('allow', "camera 'none'; microphone 'none'"); frame.setAttribute('sandbox', 'allow-scripts');
      window.links = [];
      window.addEventListener('message', async ({ source, data }) => {
        if (source !== frame.contentWindow || !data?.id) return;
        let result = {};
        if (data.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostCapabilities: { sandbox: { permissions: {} } }, hostContext: { toolInfo: { tool: { name: 'cats_roulette_open' } } } };
        if (data.method === 'tools/call') result = await window.cameraTool(data.params);
        if (data.method === 'ui/open-link') window.links.push(data.params.url);
        source.postMessage({ jsonrpc: '2.0', id: data.id, result }, '*');
      });
      frame.srcdoc = markup; document.body.append(frame);
    }, resource.result.contents[0].text);
    const frame = page.frameLocator('#widget');
    await expect(frame.locator('#chat')).toBeVisible();
    await frame.locator('[data-camera="preview"]').click();
    await expect(frame.locator('[data-camera="status"]')).toContainText('cannot open a camera');
    await frame.locator('[data-camera="external"]').click();
    await expect.poll(() => page.evaluate(() => window.links.length)).toBe(1);
    const link = new URL(await page.evaluate(() => window.links[0]));
    expect(link.pathname).toBe('/roulette-camera'); expect(new URLSearchParams(link.hash.slice(1)).get('match')).toBe(matchId);
    // A permitted host can run the exact same resource; permission remains a host decision.
    await page.locator('#widget').evaluate((node) => { node.setAttribute('allow', 'camera; microphone'); node.setAttribute('sandbox', 'allow-scripts allow-same-origin'); node.srcdoc = node.srcdoc; });
    await expect(frame.locator('#chat')).toBeVisible();
    await frame.locator('[data-camera="preview"]').click(); await expect(frame.locator('[data-camera="share"]')).toBeVisible();
    await frame.locator('[data-camera="share"]').click();
    await b.grantPermissions(['camera', 'microphone']);
    const guest = await b.newPage(); await guest.goto(`${baseURL}/roulette`);
    await cam(guest, 'preview').click(); await cam(guest, 'share').click();
    await expect(frame.locator('[data-camera="status"]')).toContainText('video call', { timeout: 20_000 });
    await expect.poll(() => frame.locator('[data-camera="remote"]').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(2);
    await expect.poll(() => cam(guest, 'remote').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(2);
    await frame.locator('[data-camera="stop"]').click();
    await cam(guest, 'stop').click();
  } finally { await cleanup([a, b], baseURL); }
});
