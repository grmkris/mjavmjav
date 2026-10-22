import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal, NearbyPeer } from '../public/nearby-peer.js';
import { publicGame } from '../public/game-core.js';
import { NearbyGame } from '../public/nearby-game.js';

const signal = { id: '00000000-0000-0000-0000-000000000001', type: 'offer', sdp: 'v=0\r\na=candidate:1 1 udp 1 192.168.1.2 12345 typ host\r\n' };
test('QR codec round-trips local SDP and rejects malformed, unrelated, oversized and expanded payloads', async () => {
  assert.deepEqual(await decodeSignal(await encodeSignal(signal)), signal);
  for (const text of ['https://example.org', 'MJAV1:garbage', 'MJAV1:' + 'A'.repeat(2400), await encodeSignal({ ...signal, type: 'other' }), await encodeSignal({ ...signal, sdp: 'v=0\r\n' })]) await assert.rejects(decodeSignal(text));
  const bytes = new Uint8Array(await new Response(new Blob([' '.repeat(20000)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  await assert.rejects(decodeSignal('MJAV1:' + btoa(String.fromCharCode(...bytes))));
});

class Channel extends EventTarget {
  readyState = 'connecting'; label = 'mjav-nearby-v1'; bufferedAmount = 0; messages = [];
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  send(data) { this.messages.push(JSON.parse(data)); }
}
class Peer extends EventTarget {
  constructor(config) { super(); assert.deepEqual(config, { iceServers: [] }); this.iceGatheringState = 'complete'; }
  createDataChannel() { return this.channel = new Channel(); }
  createOffer() { return { type: 'offer', sdp: signal.sdp }; }
  createAnswer() { return { type: 'answer', sdp: signal.sdp }; }
  async setLocalDescription(description) { this.localDescription = description; }
  async setRemoteDescription(description) { this.remoteDescription = description; }
  close() { this.closed = true; }
}
const makePeer = () => new NearbyPeer({ Peer, onStatus() {}, onMessage() {}, onOpen() {} });
test('pairing is two-way, bound to one offer, and rejects stale answers after a reset', async () => {
  const host = makePeer(), guest = makePeer();
  try {
    const offer = await host.host();
    assert.equal(host.status, 'offer');
    const answer = await guest.accept(offer);
    assert.equal(guest.status, 'answer');
    await assert.rejects(host.accept(await encodeSignal({ ...signal, id: '00000000-0000-0000-0000-000000000002', type: 'answer' })));
    assert.equal(await host.accept(answer), null);
    assert.equal(host.status, 'connecting');
    host.close(); await assert.rejects(host.accept(answer));
    await host.host(); assert.equal(host.status, 'offer');
  } finally { host.close(); guest.close(); }
});
test('channel closure and backpressure drop the session; stale channel events cannot end the next pairing', async () => {
  const peer = makePeer();
  try {
    await peer.host(); const channel = peer.channel;
    channel.readyState = 'open'; channel.dispatchEvent(new Event('open'));
    assert.equal(peer.status, 'connected');
    channel.bufferedAmount = 64001; assert.equal(peer.send({ type: 'ping' }), false);
    assert.equal(peer.status, 'disconnected');
    await peer.host(); channel.dispatchEvent(new Event('error')); assert.equal(peer.status, 'offer');
    peer.channel.close(); assert.equal(peer.status, 'disconnected');
  } finally { peer.close(); }
});
test('cancelling while decompressing cannot create a new peer', async () => {
  const peer = makePeer(), code = await encodeSignal(signal);
  const accepting = peer.accept(code); peer.close();
  await assert.rejects(accepting, /cancelled/); assert.equal(peer.pc, null);
});

test('cancelling a pending answer cannot attach a timeout to the next pairing', async () => {
  const host = makePeer(), guest = makePeer();
  try {
    const answer = await guest.accept(await host.host());
    let release, started;
    const remoteStarted = new Promise((resolve) => { started = resolve; });
    host.pc.setRemoteDescription = () => new Promise((resolve) => { release = resolve; started(); });
    const accepting = host.accept(answer); await remoteStarted;
    host.close(); await host.host(); release();
    await assert.rejects(accepting, /cancelled/); assert.equal(host.status, 'offer'); assert.equal(host.deadline, undefined);
  } finally { host.close(); guest.close(); }
});

function pairGames() {
  const snapshots = [], acks = [], hostMessages = [], guestMessages = [];
  const host = new NearbyGame({ role: 'host', send: (m) => { const copy = structuredClone(m); hostMessages.push(copy); guest.receive(copy); }, onWorld: (w) => snapshots.push(structuredClone(w)), onAck: (a) => acks.push(a) });
  const guest = new NearbyGame({ role: 'guest', send: (m) => { guestMessages.push(structuredClone(m)); host.receive(m); }, onWorld() {}, onAck: (a) => acks.push(a) });
  return { host, guest, snapshots, acks, hostMessages, guestMessages };
}
test('both humans must be ready; guest cannot inject world state or restart an active round', () => {
  const { host, guest } = pairGames();
  guest.play(); assert.equal(host.world, null); host.play();
  assert.equal(host.world.players.length, 2); assert.equal(guest.world.phase, 'countdown'); assert.equal(guest.ready, false);
  const round = host.world.round;
  host.receive({ type: 'world', world: { phase: 'over' } }); host.play(); guest.play();
  assert.equal(host.world.round, round); assert.equal(host.world.phase, 'countdown');
});
test('human plans are acknowledged once and stay private until the simultaneous reveal', () => {
  const { host, guest, acks, hostMessages } = pairGames(); host.play(); guest.play();
  for (let i = 0; i < 6; i++) host.tick(0.5);
  const plan = { round: host.world.round, turn: 1, move: 1, target: 34 };
  host.plan(plan); host.plan(plan);
  guest.plan({ ...plan, move: 34, target: 1 });
  assert.deepEqual(acks.map((a) => a.accepted), [true, false, true]);
  assert.ok(hostMessages.filter((m) => m.type === 'world').every((m) => !('plans' in m.world) && m.world.blasts.length === 0));
  for (let i = 0; i < 16; i++) host.tick(0.5);
  assert.equal(host.world.turnPhase, 'reveal');
  assert.deepEqual(guest.world.players.map((p) => p.hp), [2, 2]);
  assert.equal(guest.world.blasts.length, 2);
});
test('a complete eight-turn session reaches matching results and requires two ready votes for a rematch', () => {
  const { host, guest } = pairGames(); host.play(); guest.play();
  for (let i = 0; i < 180; i++) host.tick(0.5);
  assert.equal(host.world.phase, 'over'); assert.equal(host.world.turn, 8);
  assert.deepEqual(guest.world, JSON.parse(JSON.stringify(publicGame(host.world))));
  guest.play(); assert.equal(host.world.phase, 'over'); host.play(); assert.equal(host.world.phase, 'countdown');
});
test('malformed guest messages cannot crash or change a game, and invalid host snapshots are ignored', () => {
  const { host, guest } = pairGames();
  host.receive({ type: 'plan', move: 100, target: 0 });
  assert.equal(host.world, null);
  guest.receive({ type: 'world', world: { mode: 'bonk', phase: 'playing', players: [] } }); assert.equal(guest.world, null);
  host.play(); guest.play(); for (let i = 0; i < 6; i++) host.tick(.5);
  guest.plan({ round: host.world.round, turn: 1, move: 0, target: 100 });
  assert.equal(host.world.players[1].ready, false);
});
