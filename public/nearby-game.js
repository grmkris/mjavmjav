import { createGame, applyPlan, publicGame, stepGame } from './game-core.js';

// Only the first phone simulates the world. The guest submits controls, never scores.
export class NearbyGame {
  constructor({ role, send, onWorld, onAck }) {
    Object.assign(this, { role, send, onWorld, onAck });
    this.world = null; this.ready = false; this.guestReady = false;
  }
  publish() {
    const world = publicGame(this.world);
    this.send({ type: 'world', world }); this.onWorld(world);
  }
  play() {
    if (this.world && this.world.phase !== 'over') return;
    this.ready = true;
    if (this.role === 'guest') this.send({ type: 'ready' });
    else this.maybeStart();
  }
  maybeStart() {
    if (!this.ready || !this.guestReady || (this.world && this.world.phase !== 'over')) return;
    this.ready = false; this.guestReady = false;
    this.world = createGame('bonk', [{ id: 'host', name: 'Cat Sardine' }, { id: 'guest', name: 'Cat Loaf' }], crypto.getRandomValues(new Uint32Array(1))[0], 3);
    this.publish();
  }
  plan(plan) {
    if (this.role === 'guest') { this.send({ ...plan, type: 'plan' }); return; }
    this.submit('host', plan);
  }
  submit(id, plan) {
    const accepted = applyPlan(this.world, id, plan);
    const ack = { type: 'ack', round: plan.round, turn: plan.turn, accepted };
    if (id === 'host') this.onAck(ack); else this.send(ack);
    if (accepted) this.publish();
  }
  receive(message) {
    if (this.role === 'host') {
      if (message.type === 'ready') { this.guestReady = true; this.maybeStart(); }
      if (message.type === 'plan') this.submit('guest', message);
      return;
    }
    if (message.type === 'ack' && this.world && message.round === this.world.round && message.turn === this.world.turn && typeof message.accepted === 'boolean') this.onAck(message);
    if (message.type === 'world' && validWorld(message.world)) {
      this.world = message.world;
      if (this.world.phase === 'countdown') this.ready = false;
      this.onWorld(this.world);
    }
  }
  tick(dt) {
    if (this.role !== 'host' || !this.world || this.world.phase === 'over') return;
    stepGame(this.world, Math.min(dt, 0.5)); this.publish();
  }
}

function validWorld(world) {
  const cell = (value) => Number.isInteger(value) && value >= 0 && value < 36;
  const ids = ['host', 'guest'];
  return world?.mode === 'bonk' && typeof world.round === 'string' && !('plans' in world) &&
    ['countdown', 'playing', 'over'].includes(world.phase) && ['plan', 'reveal'].includes(world.turnPhase) &&
    Number.isInteger(world.turn) && world.turn >= 1 && world.turn <= 8 && Number.isFinite(world.turnRemaining) && world.turnRemaining >= 0 && world.turnRemaining <= 8 &&
    Number.isFinite(world.countdown) && world.countdown >= 0 && world.countdown <= 3 && Array.isArray(world.players) && world.players.length === 2 &&
    world.players.every((p, i) => p && p.id === ids[i] && typeof p.name === 'string' && p.name.length < 40 && cell(p.cell) && Number.isInteger(p.hp) && p.hp >= 0 && p.hp <= 3 && Number.isInteger(p.shields) && p.shields >= 0 && p.shields <= 2 && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.score) && typeof p.color === 'string') &&
    Array.isArray(world.events) && world.events.length <= 6 && world.events.every((s) => typeof s === 'string' && s.length <= 300) &&
    Array.isArray(world.winners) && world.winners.length <= 2 && world.winners.every((id) => ids.includes(id)) &&
    Array.isArray(world.blasts) && world.blasts.length <= 2 && world.blasts.every((b) => b && cell(b.cell) && ids.includes(b.by) && typeof b.color === 'string');
}
