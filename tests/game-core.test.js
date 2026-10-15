import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyInput, stepGame } from '../public/game-core.js';

const roster = [{ id: 'a', name: 'Soup' }, { id: 'b', name: 'Bean' }];

test('identical seeds and inputs produce the same race in browser and server', () => {
  for (const mode of ['flappy', 'jump']) {
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
