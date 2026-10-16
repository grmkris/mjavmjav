import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, actOnMatch, matchView } from '../src/roulette-core.js';
import { videoAction, VIDEO_LEASE_MS } from '../src/roulette-video-core.js';
const now = 100_000, members = [{ id: 'a', name: 'Cat A' }, { id: 'b', name: 'Cat B' }];
const sa = '11111111-1111-4111-8111-111111111111', sb = '22222222-2222-4222-8222-222222222222', sc = '33333333-3333-4333-8333-333333333333';
function setup() {
  const match = newMatch('match', members, now), video = {};
  const act = (id, session, action, args = {}, time = now) => videoAction(match, video, id, session, action, args, time);
  return { match, video, act, accept() { for (const id of ['a', 'b']) actOnMatch(match, id, 'accept', { operationId: `accept-${id}-123` }, now); } };
}
test('camera access requires both paws, membership, and a live match', () => {
  const f = setup(); assert.throws(() => f.act('a', sa, 'open'), /pawshake/);
  f.accept(); assert.throws(() => f.act('outsider', sa, 'open'), /not your/);
  f.act('a', sa, 'open'); actOnMatch(f.match, 'b', 'leave', { operationId: 'leave-operation' }, now);
  assert.throws(() => f.act('a', sa, 'poll'), /pawshake/);
});
test('signaling is bound to both camera sessions and absent from model-visible state', () => {
  const f = setup(); f.accept(); f.act('a', sa, 'open'); f.act('b', sb, 'open');
  const description = { type: 'offer', sdp: 'v=0\r\nprivate-camera-description' };
  f.act('a', sa, 'signal', { peerSession: sb, description });
  assert.deepEqual(f.act('b', sb, 'poll').description, description);
  assert.equal(f.act('a', sa, 'poll').description, null);
  assert.ok(!JSON.stringify(matchView(f.match, 'b', now)).includes('private-camera'));
  assert.throws(() => f.act('a', sa, 'signal', { peerSession: sc, description }), /changed/);
  assert.throws(() => f.act('b', sb, 'signal', { peerSession: sa, description }), /Unexpected/);
});
test('rejoining never receives a previous session description; stale closes cannot close a new camera', () => {
  const f = setup(); f.accept(); f.act('a', sa, 'open'); f.act('b', sb, 'open');
  f.act('a', sa, 'signal', { peerSession: sb, description: { type: 'offer', sdp: 'v=0 old' } });
  assert.throws(() => f.act('b', sc, 'open'), /another tab/);
  f.act('b', sb, 'close'); f.act('b', sc, 'open');
  assert.equal(f.act('b', sc, 'poll').description, null);
  f.act('b', sb, 'close'); assert.equal(f.act('b', sc, 'poll').sessionId, sc);
});
test('silent camera clients expire and cannot keep sending without explicitly reopening', () => {
  const f = setup(); f.accept(); f.act('a', sa, 'open'); f.act('b', sb, 'open');
  f.act('a', sa, 'poll', {}, now + VIDEO_LEASE_MS - 1000);
  assert.equal(f.act('a', sa, 'poll', {}, now + VIDEO_LEASE_MS).peer, null);
  assert.throws(() => f.act('b', sb, 'poll', {}, now + VIDEO_LEASE_MS), /session ended/);
});
test('camera payloads and update rates are bounded', () => {
  const f = setup(); f.accept(); f.act('a', sa, 'open'); f.act('b', sb, 'open');
  assert.throws(() => f.act('a', sa, 'signal', { peerSession: sb, description: { type: 'offer', sdp: 'v=0' + 'x'.repeat(24000) } }), /Invalid camera/);
  for (let i = 0; i < 9; i++) f.act('a', sa, 'poll');
  f.act('a', sa, 'poll'); assert.throws(() => f.act('a', sa, 'poll'), /Too many/);
});
