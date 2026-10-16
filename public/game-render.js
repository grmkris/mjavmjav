import { WIDTH, HEIGHT, cellPoint, cellDistance, canStep } from './game-core.js';

function rounded(ctx, x, y, w, h, radius, fill, stroke = '#171229') {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
}

function cat(ctx, player, y, self) {
  ctx.save(); ctx.translate(player.x, y);
  ctx.globalAlpha = player.alive ? (self ? 1 : 0.65) : 0.25;
  ctx.rotate(Math.max(-0.25, Math.min(0.35, player.vy / 1200)));
  ctx.fillStyle = player.color; ctx.strokeStyle = '#171229'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-18, -3); ctx.lineTo(-18, -22); ctx.lineTo(-5, -13); ctx.lineTo(7, -13); ctx.lineTo(18, -22); ctx.lineTo(19, 7); ctx.quadraticCurveTo(18, 20, 0, 19); ctx.quadraticCurveTo(-20, 18, -18, -3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#171229';
  ctx.beginPath(); ctx.ellipse(-7, -1, 3, 6, 0, 0, Math.PI * 2); ctx.ellipse(7, -1, 3, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff6b4a'; ctx.beginPath(); ctx.moveTo(-3, 9); ctx.lineTo(3, 9); ctx.lineTo(0, 13); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-14, 7); ctx.lineTo(-24, 4); ctx.moveTo(14, 7); ctx.lineTo(24, 4); ctx.stroke();
  ctx.restore();
  if (!self) {
    ctx.font = 'bold 10px "Bricolage Grotesque", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#171229';
    ctx.fillText(player.name, player.x, y - 28);
  }
}

function cucumber(ctx, x, y, h) {
  if (h <= 0) return;
  rounded(ctx, x, y, 60, h, 15, '#79d79b');
  ctx.fillStyle = '#379567';
  for (let row = 0; row < h / 27; row++) {
    ctx.beginPath(); ctx.ellipse(x + 16 + (row % 2) * 24, y + row * 27 + 14, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBonk(ctx, world, selfId, draft) {
  ctx.fillStyle = '#f6d6e5'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const self = world.players.find((player) => player.id === selfId);
  ctx.textAlign = 'center'; ctx.fillStyle = '#171229';
  ctx.font = '800 30px "Bricolage Grotesque", sans-serif';
  ctx.fillText('Bonk Club', WIDTH / 2, 43);
  ctx.font = 'bold 15px "Bricolage Grotesque", sans-serif';
  const subtitle = world.turnPhase === 'reveal' ? 'fish have consequences.' : `turn ${world.turn} / 8 · ${Math.ceil(world.turnRemaining)}s to plot`;
  ctx.fillText(subtitle, WIDTH / 2, 69);
  ctx.font = 'bold 12px "Bricolage Grotesque", sans-serif';
  for (let i = 0; i < 6; i++) {
    ctx.fillText('ABCDEF'[i], 70 + i * 56, 102);
    ctx.fillText(String(i + 1), 27, 145 + i * 56);
  }
  for (let cell = 0; cell < 36; cell++) {
    const { x, y } = cellPoint(cell);
    const blasted = world.turnPhase === 'reveal' && world.blasts.some((blast) => cellDistance(cell, blast.cell) <= 1);
    const aimed = draft?.target != null && world.turnPhase === 'plan' && cellDistance(cell, draft.target) <= 1;
    const reachable = self?.alive && world.turnPhase === 'plan' && draft?.tool === 'move' && canStep(cell, self.cell);
    rounded(ctx, x - 27, y - 27, 54, 54, 6, blasted ? '#ffad70' : aimed ? '#ff91d188' : reachable ? '#ddff4599' : (cell + Math.floor(cell / 6)) % 2 ? '#fff4d6' : '#f7e7c5', '#17122933');
    if (draft && world.turnPhase === 'plan' && (cell === draft.move || cell === draft.target)) {
      ctx.lineWidth = 4; ctx.strokeStyle = cell === draft.target ? '#a82961' : '#29745d';
      ctx.strokeRect(x - 23, y - 23, 46, 46);
    }
  }
  for (const player of world.players) {
    const peers = world.players.filter((p) => p.cell === player.cell);
    const offset = (peers.indexOf(player) - (peers.length - 1) / 2) * 9;
    ctx.save(); ctx.translate(player.x + offset, player.y + 4); ctx.scale(0.75, 0.75);
    cat(ctx, { ...player, x: 0, vy: 0 }, 0, true); ctx.restore();
    ctx.fillStyle = '#171229'; ctx.font = '800 10px "Bricolage Grotesque", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${world.players.indexOf(player) + 1}${player.id === selfId ? ' you' : ''}`, player.x + offset, player.y - 19);
    ctx.fillText(player.alive ? '♥'.repeat(player.hp) : '×', player.x + offset, player.y + 23);
    if (player.guarding && world.turnPhase === 'reveal') {
      ctx.strokeStyle = '#29745d'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y, 24, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (const blast of world.blasts) {
    const { x, y } = cellPoint(blast.cell);
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = '#ff6b4a'; ctx.strokeStyle = '#171229'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(19, -7); ctx.lineTo(19, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#171229'; ctx.beginPath(); ctx.arc(-6, -1, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = '#171229'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Bricolage Grotesque", sans-serif';
  const captions = world.turnPhase === 'reveal' ? ['Fish hit the marked tile + its four neighbours.', 'Shields block fish. Your own fish can bonk you.'] : ['Move one tile, diagonals too. Dodge the fish.', 'Pick a fish target or spend one of your 2 shields.'];
  captions.forEach((line, i) => ctx.fillText(line, WIDTH / 2, 482 + i * 22));
  ctx.fillText(`${world.players.filter((p) => p.ready && p.alive).length} plans locked · all reveal together`, WIDTH / 2, 542);
}

export function drawGame(ctx, world, selfId, now, reduceMotion, draft) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = world.mode === 'flappy' ? '#d7c4f6' : '#b8ebdd'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = world.mode === 'flappy' ? '#eadcf9' : '#d4f5ec';
  for (let i = 0; i < 6; i++) {
    const drift = reduceMotion ? 0 : now * 0.004;
    const x = ((i * 137 - drift) % 540 + 540) % 540 - 60;
    ctx.beginPath(); ctx.ellipse(x, 80 + i * 73 % 300, 65, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  const self = world.players.find((p) => p.id === selfId) || world.players.find((p) => p.alive) || world.players[0];
  if (world.mode === 'bonk') {
    drawBonk(ctx, world, selfId, draft);
  } else if (world.mode === 'flappy') {
    for (const pipe of world.pipes) {
      cucumber(ctx, pipe.x, -20, pipe.gap + 20);
      cucumber(ctx, pipe.x, pipe.gap + 185, HEIGHT - pipe.gap - 185);
    }
    rounded(ctx, -10, HEIGHT - 20, WIDTH + 20, 35, 0, '#ffad70');
    ctx.fillStyle = '#171229'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left'; ctx.fillText('the cucumber industrial complex', 16, HEIGHT - 7);
    for (const player of world.players.filter((p) => p.id !== selfId)) cat(ctx, player, player.y, false);
    if (self) cat(ctx, self, self.y, true);
  } else if (world.mode === 'jump') {
    const camera = Math.min(0, (self?.bestY ?? 480) - 245);
    for (const pad of world.platforms) {
      if (self?.broken?.includes(pad.index)) continue;
      const y = pad.y - camera;
      if (y < -20 || y > HEIGHT + 20) continue;
      rounded(ctx, pad.x, y, pad.width, 13, 5, pad.fragile ? '#ffad70' : '#fff4d6');
      if (pad.fragile) {
        ctx.fillStyle = '#171229'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('crumbly', pad.x + pad.width / 2, y + 10);
      }
    }
    for (const player of world.players.filter((p) => p.id !== selfId)) cat(ctx, player, player.y - camera, false);
    if (self) cat(ctx, self, self.y - camera, true);
    if (self && self.bestY < -100) {
      ctx.fillStyle = '#17122999'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(self.score > 150 ? 'ground privileges revoked' : 'the floor misses you', WIDTH / 2, HEIGHT - 28);
    }
    const danger = Math.max(0, world.danger - camera);
    if (danger < HEIGHT) {
      ctx.fillStyle = '#ff6b4a99'; ctx.fillRect(0, danger, WIDTH, HEIGHT - danger);
      ctx.fillStyle = '#171229'; ctx.font = 'bold 12px "Bricolage Grotesque", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('the floor is getting ideas', WIDTH / 2, Math.min(HEIGHT - 8, danger + 20));
    }
  } else if (world.mode === 'dodge') {
    ctx.fillStyle = '#ffad70'; ctx.fillRect(0, 510, WIDTH, 50);
    ctx.fillStyle = '#171229'; ctx.textAlign = 'center'; ctx.font = 'bold 13px "Bricolage Grotesque", sans-serif';
    ctx.fillText('geese have chosen violence', WIDTH / 2, 545);
    for (const hazard of world.hazards) {
      ctx.save(); ctx.translate(hazard.x, hazard.y);
      ctx.fillStyle = '#fff4d6'; ctx.strokeStyle = '#171229'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 3, hazard.radius, hazard.radius * 0.7, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      rounded(ctx, 3, -hazard.radius, 14, 25, 7, '#fff4d6');
      ctx.fillStyle = '#ff6b4a'; ctx.beginPath(); ctx.moveTo(16, -17); ctx.lineTo(28, -12); ctx.lineTo(16, -9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#171229'; ctx.beginPath(); ctx.arc(12, -16, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (const player of world.players.filter((p) => p.id !== selfId)) cat(ctx, player, player.y, false);
    if (self) cat(ctx, self, self.y, true);
  }
  if (world.phase === 'countdown') {
    ctx.fillStyle = '#17122999'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ddff45'; ctx.font = '800 100px "Bricolage Grotesque", sans-serif';
    ctx.fillText(String(Math.ceil(world.countdown)), WIDTH / 2, HEIGHT / 2 + 30);
    ctx.fillStyle = '#fff4d6'; ctx.font = 'bold 17px "Bricolage Grotesque", sans-serif'; ctx.fillText('prepare your one brain cell', WIDTH / 2, HEIGHT / 2 + 65);
  }
}
