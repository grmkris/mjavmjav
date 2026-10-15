export const WIDTH = 420;
export const HEIGHT = 560;
export const MODES = ['flappy', 'jump'];
export const COLORS = ['#ddff45', '#ff91d1', '#76ead2', '#ffad70', '#91bbff', '#e6afff', '#fff4d6', '#e6fbff'];
export const ROOM_SOUNDS = ['mjav', 'prrr', 'blep', 'yap', 'eepy', 'ufo', 'honk', 'bonk', 'boing', 'ascend'];
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

function random(world) {
  world.rng = (Math.imul(world.rng, 1664525) + 1013904223) >>> 0;
  return world.rng / 4294967296;
}

function platform(world, index, lastX) {
  return { x: clamp(lastX + (random(world) - 0.5) * 160, 12, WIDTH - 108), y: 530 - index * 75, width: 96, index };
}

export function createGame(mode, roster, seed, countdown = 0) {
  const world = {
    mode, phase: countdown ? 'countdown' : 'playing', countdown, elapsed: 0,
    round: String(seed), rng: seed >>> 0, distance: 0, pipes: [], platforms: [],
    players: roster.map((player, i) => ({
      ...player, color: player.color || COLORS[i % COLORS.length],
      x: mode === 'flappy' ? 112 : 210, y: mode === 'flappy' ? 245 : 480,
      vy: mode === 'flappy' ? 0 : -520, direction: 0, score: 0,
      bestY: 480, alive: true, lastFlap: -1, jumps: 0, survived: 0,
    })),
  };
  if (mode === 'flappy') {
    for (let i = 0; i < 4; i++) world.pipes.push({ x: 480 + i * 250, gap: 110 + random(world) * 170, passed: false });
  } else {
    world.platforms.push({ x: 0, y: 530, width: WIDTH, index: 0 });
    for (let i = 1; i < 20; i++) world.platforms.push(platform(world, i, world.platforms.at(-1).x || 162));
  }
  return world;
}

export function applyInput(world, id, input) {
  const player = world?.players.find((item) => item.id === id);
  if (!player || !player.alive || world.phase !== 'playing') return;
  if (world.mode === 'flappy' && input.flap && world.elapsed - player.lastFlap >= 0.095) {
    player.vy = -325;
    player.lastFlap = world.elapsed;
  }
  if (world.mode === 'jump' && Number.isInteger(input.direction) && Math.abs(input.direction) <= 1) player.direction = input.direction;
}

export function stepGame(world, dt) {
  if (world.phase === 'over') return;
  if (world.phase === 'countdown') {
    world.countdown = Math.max(0, world.countdown - dt);
    if (!world.countdown) world.phase = 'playing';
    return;
  }
  world.elapsed += dt;
  for (const player of world.players) if (player.alive) player.survived = world.elapsed;
  if (world.mode === 'flappy') {
    const distance = (145 + Math.min(45, world.elapsed * 0.8)) * dt;
    world.distance += distance;
    for (const pipe of world.pipes) {
      pipe.x -= distance;
      if (!pipe.passed && pipe.x + 60 < 94) {
        pipe.passed = true;
        for (const player of world.players) if (player.alive) player.score += 1;
      }
    }
    if (world.pipes[0].x < -70) {
      world.pipes.shift();
      world.pipes.push({ x: world.pipes.at(-1).x + 250, gap: 100 + random(world) * 190, passed: false });
    }
    for (const player of world.players) {
      if (!player.alive) continue;
      player.vy += 930 * dt;
      player.y += player.vy * dt;
      if (player.y < 18 || player.y > HEIGHT - 36) player.alive = false;
      for (const pipe of world.pipes) {
        if (player.x + 17 > pipe.x && player.x - 17 < pipe.x + 60 && (player.y - 15 < pipe.gap || player.y + 15 > pipe.gap + 185)) player.alive = false;
      }
    }
  } else {
    for (const player of world.players) {
      if (!player.alive) continue;
      const previousY = player.y;
      player.vy += 1050 * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x + player.direction * 255 * dt, 17, WIDTH - 17);
      if (player.vy > 0) {
        for (const pad of world.platforms) {
          if (previousY + 16 <= pad.y && player.y + 16 >= pad.y && player.x + 13 > pad.x && player.x - 13 < pad.x + pad.width) {
            player.y = pad.y - 16;
            player.vy = -520;
            player.jumps += 1;
            break;
          }
        }
      }
      player.bestY = Math.min(player.bestY, player.y);
      player.score = Math.max(player.score, Math.floor((480 - player.bestY) / 10));
      if (player.y > Math.min(HEIGHT + 25, player.bestY + 450)) player.alive = false;
    }
    const highest = Math.min(...world.players.map((player) => player.bestY));
    while (world.platforms.at(-1).y > highest - 700 && world.platforms.length < 700) {
      world.platforms.push(platform(world, world.platforms.length, world.platforms.at(-1).x));
    }
  }
  if (world.elapsed >= 75 || !world.players.some((player) => player.alive)) world.phase = 'over';
}
