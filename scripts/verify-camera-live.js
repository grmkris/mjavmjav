// Explicit production acceptance with two owned synthetic participants.
// Abort before accepting if either test cat encounters anyone else in the global queue.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

if (!process.argv.includes('--live')) throw new Error('Pass --live to run one bounded synthetic call on mjavmjav.com.');
const base = 'https://mjavmjav.com';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const contexts = [], pages = [];
const act = async (ctx, action, args = {}) => {
  const response = await ctx.request.post(`${base}/api/roulette`, { headers: { Origin: base }, data: { action, operationId: crypto.randomUUID(), ...args } });
  assert.equal(response.status(), 200, `Roulette ${action} failed (${response.status()})`); return response.json();
};
const waitFor = async (check, label, timeout = 30_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 390, height: 844 } });
    contexts.push(context);
    await context.addInitScript(() => {
      window.probePeers = []; window.probeTracks = [];
      const Peer = RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.probePeers.push(this); } };
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (args) => { const stream = await capture(args); window.probeTracks.push(...stream.getTracks()); return stream; };
    });
    pages.push(await context.newPage());
  }
  const identities = await Promise.all(contexts.map((ctx) => act(ctx, 'status')));
  const ids = identities.map((s) => s.me.id);
  await act(contexts[0], 'join');
  const second = await act(contexts[1], 'join');
  assert.deepEqual(second.match?.members.map((m) => m.id).sort(), [...ids].sort(), 'Unexpected participant. Aborting without accepting or sharing.');
  const matchId = second.match.id;
  for (const ctx of contexts) await act(ctx, 'accept', { matchId });
  for (const page of pages) { await page.goto(`${base}/roulette`); await page.locator('[data-camera="preview"]').click(); await page.locator('[data-camera="share"]').click(); }
  const receipts = [];
  for (const page of pages) {
    await waitFor(() => page.evaluate(() => window.probePeers.at(-1)?.connectionState === 'connected'), 'relay connection');
    await waitFor(() => page.locator('[data-camera="remote"]').evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames > 5), 'decoded remote video');
    const receipt = await page.evaluate(async () => {
      const pc = window.probePeers.at(-1), stats = await pc.getStats();
      const transport = [...stats.values()].find((s) => s.type === 'transport' && s.selectedCandidatePairId), pair = stats.get(transport?.selectedCandidatePairId);
      const inbound = [...stats.values()].find((s) => s.type === 'inbound-rtp' && s.kind === 'video');
      return { policy: pc.getConfiguration().iceTransportPolicy, localCandidate: stats.get(pair?.localCandidateId)?.candidateType, remoteCandidate: stats.get(pair?.remoteCandidateId)?.candidateType, framesDecoded: inbound?.framesDecoded || 0, audioTracks: window.probeTracks.filter((t) => t.kind === 'audio').length };
    });
    assert.equal(receipt.policy, 'relay'); assert.equal(receipt.localCandidate, 'relay'); assert.equal(receipt.remoteCandidate, 'relay'); assert.ok(receipt.framesDecoded > 5); assert.equal(receipt.audioTracks, 0); receipts.push(receipt);
  }
  for (let i = 0; i < 2; i++) {
    await pages[i].locator('[data-camera="mic"]').click();
    await waitFor(() => pages[1-i].evaluate(async () => [...(await window.probePeers.at(-1).getStats()).values()].some((s) => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0)), 'relayed audio');
    await pages[i].locator('[data-camera="mic"]').click();
  }
  await act(contexts[0], 'leave', { matchId });
  for (const page of pages) await waitFor(() => page.evaluate(() => window.probeTracks.every((t) => t.readyState === 'ended')), 'track release', 10_000);
  console.log(JSON.stringify({ result: 'passed', site: base, participants: receipts, audioBothDirections: true, tracksReleasedOnLeave: true }));
} finally {
  for (const ctx of contexts) { try { const state = await act(ctx, 'status'); await act(ctx, 'leave', state.match ? { matchId: state.match.id } : {}); } catch { /* Close synthetic devices below. */ } await ctx.close(); }
  await browser.close();
}
