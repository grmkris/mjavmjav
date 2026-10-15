export const WIDTH = 420;
export const HEIGHT = 560;
export const MODES = ['flappy', 'jump', 'dodge'];
export const COLORS = ['#ddff45', '#ff91d1', '#76ead2', '#ffad70', '#91bbff', '#e6afff', '#fff4d6', '#e6fbff'];
export const ROOM_SOUNDS = ['mjav', 'prrr', 'blep', 'yap', 'eepy', 'ufo', 'honk', 'bonk', 'boing', 'ascend'];
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

function random(world) {
  world.rng = (Math.imul(world.rng, 1664525) + 1013904223) >>> 0;
  return world.rng / 4294967296;
}

function platform(world, index, lastX) {
  const width = Math.max(52, 94 - index * 1.6);
  // Alternating sides force steering; each gap stays within jump reach.
  const offset = 55 + random(world) * 70;
  return { x: clamp(lastX + (index % 2 ? -offset : offset), 18, WIDTH - width - 18), y: 530 - index * 92, width, index, fragile: index > 2 && index % 3 === 0 };
}

export function createGame(mode, roster, seed, countdown = 0) {
  const world = {
    version: 2,
    mode, phase: countdown ? 'countdown' : 'playing', countdown, elapsed: 0,
    round: String(seed), rng: seed >>> 0, distance: 0, pipes: [], platforms: [],
    hazards: [], nextHazard: 0.65, danger: HEIGHT + 90, nextPlatform: 20,
    players: roster.map((player, i) => ({
      ...player, color: player.color || COLORS[i % COLORS.length],
      x: mode === 'flappy' ? 112 : 210, y: mode === 'flappy' ? 245 : mode === 'jump' ? 480 : 455,
      vy: mode === 'jump' ? -520 : 0, direction: 0, score: 0,
      bestY: 480, alive: true, lastFlap: -1, jumps: 0, survived: 0, broken: [],
    })),
  };
  if (mode === 'flappy') {
    for (let i = 0; i < 4; i++) world.pipes.push({ x: 480 + i * 250, gap: 110 + random(world) * 170, passed: false });
  } else if (mode === 'jump') {
    world.platforms.push({ x: 0, y: 530, width: WIDTH, index: 0 });
    for (let i = 1; i < 20; i++) world.platforms.push(platform(world, i, i === 1 ? 162 : world.platforms.at(-1).x));
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
  if (world.mode !== 'flappy' && Number.isInteger(input.direction) && Math.abs(input.direction) <= 1) player.direction = input.direction;
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
  } else if (world.mode === 'jump') {
    world.danger -= (30 + Math.min(22, world.elapsed * 0.5)) * dt;
    for (const player of world.players) {
      if (!player.alive) continue;
      const previousY = player.y;
      player.vy += 1050 * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x + player.direction * 255 * dt, 17, WIDTH - 17);
      if (player.vy > 0) {
        for (const pad of world.platforms) {
          if (player.broken.includes(pad.index)) continue;
          if (previousY + 16 <= pad.y && player.y + 16 >= pad.y && player.x + 13 > pad.x && player.x - 13 < pad.x + pad.width) {
            player.y = pad.y - 16;
            player.vy = -520;
            player.jumps += 1;
            // Toast crumbles for each cat separately: no one can sabotage a landing.
            if (pad.fragile) player.broken.push(pad.index);
            break;
          }
        }
      }
      player.bestY = Math.min(player.bestY, player.y);
      player.score = Math.max(player.score, Math.floor((480 - player.bestY) / 10));
      if (player.y + 16 > Math.min(world.danger, player.bestY + 450)) player.alive = false;
    }
    const highest = Math.min(...world.players.map((player) => player.bestY));
    while (world.platforms.at(-1).y > highest - 700 && world.nextPlatform < 700) {
      world.platforms.push(platform(world, world.nextPlatform++, world.platforms.at(-1).x));
    }
    // Nobody can return below the danger line. Retire those pads from every snapshot.
    world.platforms = world.platforms.filter((pad) => pad.y < world.danger + 30);
    const first = world.platforms[0]?.index || 0;
    for (const player of world.players) player.broken = player.broken.filter((index) => index >= first);
  } else if (world.mode === 'dodge') {
    world.nextHazard -= dt;
    if (world.nextHazard <= 0) {
      world.hazards.push({ x: 24 + random(world) * (WIDTH - 48), y: -32, radius: 18 + random(world) * 9, speed: 200 + Math.min(230, world.elapsed * 5) });
      world.nextHazard += Math.max(0.2, 0.7 - world.elapsed * 0.012);
    }
    for (const hazard of world.hazards) hazard.y += hazard.speed * dt;
    world.hazards = world.hazards.filter((hazard) => hazard.y < HEIGHT + 45);
    for (const player of world.players) {
      if (!player.alive) continue;
      player.x = clamp(player.x + player.direction * 300 * dt, 17, WIDTH - 17);
      player.score = Math.floor(world.elapsed * 10);
      for (const hazard of world.hazards) {
        if (Math.abs(hazard.x - player.x) < hazard.radius + 13 && Math.abs(hazard.y - player.y) < hazard.radius + 14) player.alive = false;
      }
    }
  }
  if (world.elapsed >= 75 || !world.players.some((player) => player.alive)) world.phase = 'over';
}
