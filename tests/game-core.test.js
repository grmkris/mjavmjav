import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyInput, stepGame } from '../public/game-core.js';

const roster = [{ id: 'a', name: 'Soup' }, { id: 'b', name: 'Bean' }];

test('identical seeds and inputs produce the same race in browser and server', () => {
  for (const mode of ['flappy', 'jump', 'dodge']) {
    const first = createGame(mode, roster, 1234, 3);
    const second = createGame(mode, roster, 1234, 3);
    for (let frame = 0; frame < 900; frame++) {
      for (const world of [first, second]) {
        if (frame % 25 === 0) applyInput(world, 'a', { flap: true, direction: frame % 50 === 0 ? 1 : -1 });
        stepGame(world, 1 / 60);
      }
      assert.deepEqual(first, second);
    }
  }
});

test('countdown prevents movement and early inputs', () => {
  const world = createGame('flappy', roster, 2, 3);
  applyInput(world, 'a', { flap: true });
  for (let i = 0; i < 120; i++) stepGame(world, 1 / 60);
  assert.equal(world.phase, 'countdown');
  assert.equal(world.players[0].y, 245);
  assert.equal(world.players[0].vy, 0);
  for (let i = 0; i < 100; i++) stepGame(world, 1 / 60);
  assert.equal(world.phase, 'playing');
  assert.ok(world.players[0].y > 245);
});

test('flapping only affects the sender and rejects rapid repeated flaps', () => {
  const world = createGame('flappy', roster, 1);
  applyInput(world, 'a', { flap: true });
  stepGame(world, 1 / 60);
  assert.ok(world.players[0].y < 245);
  assert.ok(world.players[1].y > 245);
  const velocity = world.players[0].vy;
  applyInput(world, 'a', { flap: true });
  assert.equal(world.players[0].vy, velocity);
});

test('cucumber collisions kill one cat while a cat in the gap survives', () => {
  const world = createGame('flappy', roster, 1);
  world.pipes = [{ x: 110, gap: 200, passed: false }];
  world.players[0].y = 100;
  world.players[1].y = 290;
  stepGame(world, 1 / 60);
  assert.equal(world.players[0].alive, false);
  assert.equal(world.players[1].alive, true);
  assert.equal(world.phase, 'playing');
});

test('jump cats land on platforms from above and fall through from below', () => {
  const world = createGame('jump', roster, 1);
  world.platforms = [{ x: 0, y: 300, width: 420, index: 0 }, { x: 100, y: -1000, width: 96, index: 1 }];
  world.players[0].y = 280; world.players[0].vy = 400;
  world.players[1].y = 330; world.players[1].vy = -400;
  stepGame(world, 1 / 60);
  assert.equal(world.players[0].jumps, 1);
  assert.ok(world.players[0].vy < 0);
  assert.equal(world.players[1].jumps, 0);
  assert.ok(world.players[1].y < 330);
});

test('steering stays inside the arena, and a race ends at 75 seconds', () => {
  const world = createGame('jump', roster, 1);
  applyInput(world, 'a', { direction: 1 });
  world.players[0].x = 402;
  stepGame(world, 0.03);
  assert.equal(world.players[0].x, 403);
  applyInput(world, 'a', { direction: 99 });
  assert.equal(world.players[0].direction, 1);
  world.elapsed = 74.99;
  stepGame(world, 0.02);
  assert.equal(world.phase, 'over');
  const finished = structuredClone(world);
  stepGame(world, 1);
  assert.deepEqual(world, finished);
});

test('jump requires steering, with reachable gaps and smaller toast', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const world = createGame('jump', roster, seed);
    for (let i = 1; i < world.platforms.length; i++) {
      const pad = world.platforms[i];
      const previous = world.platforms[i - 1];
      assert.equal(previous.y - pad.y, 92);
      assert.ok(pad.width < 94 && pad.width >= 52);
      assert.ok(pad.x >= 0 && pad.x + pad.width <= 420);
      if (i > 1) assert.ok(Math.abs(pad.x + pad.width / 2 - previous.x - previous.width / 2) < 180);
    }
    for (let frame = 0; frame < 1200 && world.phase !== 'over'; frame++) stepGame(world, 1 / 60);
    assert.equal(world.phase, 'over', 'an idle cat cannot bounce forever');
    assert.ok(world.elapsed < 20);
  }
});

test('crumbly toast breaks only for the cat that landed on it', () => {
  const world = createGame('jump', roster, 1);
  world.platforms = [{ x: 0, y: 300, width: 420, index: 3, fragile: true }, { x: 100, y: -1000, width: 96, index: 4 }];
  world.players[0].y = 280; world.players[0].vy = 400;
  world.players[1].y = 250; world.players[1].vy = 0;
  stepGame(world, 1 / 60);
  assert.deepEqual(world.players[0].broken, [3]);
  assert.deepEqual(world.players[1].broken, []);
  for (const player of world.players) { player.y = 280; player.vy = 400; }
  stepGame(world, 1 / 60);
  assert.equal(world.players[0].jumps, 1, 'broken toast cannot bounce the same cat twice');
  assert.equal(world.players[1].jumps, 1, 'another cat still gets its own landing');
});

test('falling geese collide with individual cats and steering stays bounded', () => {
  const world = createGame('dodge', roster, 1);
  world.players[1].x = 402;
  applyInput(world, 'b', { direction: 1 });
  world.hazards = [{ x: 210, y: 450, radius: 20, speed: 200 }];
  stepGame(world, 1 / 60);
  assert.equal(world.players[0].alive, false);
  assert.equal(world.players[1].alive, true);
  assert.equal(world.players[1].x, 403);
  applyInput(world, 'b', { direction: -1 });
  stepGame(world, 1 / 60);
  assert.equal(world.players[1].x, 398);
});

test('goose difficulty increases while old hazards are removed', () => {
  const early = createGame('dodge', roster, 1);
  const late = createGame('dodge', roster, 1);
  early.nextHazard = 0; late.nextHazard = 0; late.elapsed = 60;
  stepGame(early, 1 / 60); stepGame(late, 1 / 60);
  assert.ok(late.hazards[0].speed > early.hazards[0].speed);
  assert.ok(late.nextHazard < early.nextHazard);
  late.hazards.push({ x: 30, y: 700, radius: 20, speed: 200 });
  stepGame(late, 1 / 60);
  assert.equal(late.hazards.length, 1);
  assert.ok(late.players[0].score >= 600);
});
