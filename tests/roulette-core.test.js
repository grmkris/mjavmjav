import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, actOnMatch, matchView, MATCH_MS, HANDSHAKE_MS } from '../src/roulette-core.js';
const now = 100000, members = [{ id: 'a', name: 'Cat A' }, { id: 'b', name: 'Cat B' }];
const fresh = () => newMatch('match', members, now);
let seq = 0;
const act = (m, who, type, args = {}, time = now) => actOnMatch(m, who, type, { operationId: `operation-${++seq}`, ...args }, time);
const active = () => { const m = fresh(); act(m, 'a', 'accept'); act(m, 'b', 'accept'); return m; };
test('both paws are required before chat or games; outsiders cannot read or accept', () => {
  const m = fresh(); act(m, 'a', 'accept');
  assert.equal(m.phase, 'handshake');
  assert.throws(() => act(m, 'a', 'say', { text: 'early' }), /Both people/);
  assert.throws(() => act(m, 'a', 'game'), /Both people/);
  assert.throws(() => matchView(m, 'outsider', now), /not your/);
  assert.throws(() => act(m, 'outsider', 'accept'), /not your/);
  act(m, 'b', 'accept'); assert.equal(m.phase, 'active');
});
test('messages carry channel, enforce size and rate, and identical retry is exactly once', () => {
  const m = active(), args = { text: 'hello', operationId: 'same-operation' };
  actOnMatch(m, 'a', 'say', args, now, 'app');
  actOnMatch(m, 'a', 'say', args, now + 10, 'app');
  assert.equal(m.messages.length, 1); assert.equal(m.messages[0].channel, 'app');
  assert.throws(() => actOnMatch(m, 'a', 'say', { ...args, text: 'changed' }, now + 1000, 'app'), /different action/);
  assert.throws(() => act(m, 'a', 'say', { text: 'fast' }, now + 500), /One yap/);
  assert.throws(() => act(m, 'a', 'say', { text: 'x'.repeat(601) }, now + 2000), /1–600/);
  act(m, 'b', 'say', { text: 'agent' }, now); assert.equal(m.messages[1].channel, 'agent');
});
test('Toe Beans enforces membership, turn, board identity, occupancy and win', () => {
  const m = active(); act(m, 'a', 'game'); const gameId = m.game.id;
  assert.throws(() => act(m, 'b', 'move', { gameId, cell: 0 }), /turn/);
  assert.throws(() => act(m, 'a', 'move', { gameId: 'old', cell: 0 }), /current/);
  act(m, 'a', 'move', { gameId, cell: 0 });
  assert.throws(() => act(m, 'b', 'move', { gameId, cell: 0 }), /empty/);
  for (const [who, cell] of [['b',3], ['a',1], ['b',4], ['a',2]]) act(m, who, 'move', { gameId, cell });
  assert.equal(m.game.winner, 'a'); assert.equal(m.game.moves, 5);
  assert.throws(() => act(m, 'b', 'move', { gameId, cell: 8 }), /turn/);
  act(m, 'b', 'game'); assert.notEqual(m.game.id, gameId);
});
test('draw ends board and unfinished games cannot be reset', () => {
  const m = active(); act(m, 'a', 'game'); const gameId = m.game.id;
  assert.throws(() => act(m, 'b', 'game'), /still going/);
  [0,1,2,4,3,5,7,6,8].forEach((cell, index) => act(m, index % 2 ? 'b' : 'a', 'move', { gameId, cell }));
  assert.equal(m.game.winner, 'draw');
});
test('decline, handshake timeout and expiry close access and clear text including retry history', () => {
  const pending = fresh(); assert.equal(matchView(pending, 'a', now + HANDSHAKE_MS).phase, 'closed');
  assert.throws(() => act(pending, 'a', 'accept'), /ended/);
  const m = active(); act(m, 'a', 'say', { text: 'private yap' }); act(m, 'a', 'leave');
  assert.equal(m.phase, 'closed'); assert.ok(!JSON.stringify(m).includes('private yap'));
  const expiring = active(); act(expiring, 'b', 'say', { text: 'expired yap' });
  matchView(expiring, 'a', now + MATCH_MS); assert.ok(!JSON.stringify(expiring).includes('expired yap'));
});
test('separate matches cannot leak messages or game state', () => {
  const one = active(), two = active(); act(one, 'a', 'say', { text: 'secret' }); act(one, 'a', 'game');
  const view = matchView(two, 'a', now); assert.deepEqual(view.messages, []); assert.equal(view.game, null);
});
