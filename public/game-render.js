import { WIDTH, HEIGHT } from './game-core.js';

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

export function drawGame(ctx, world, selfId, now, reduceMotion) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = world.mode === 'flappy' ? '#d7c4f6' : '#b8ebdd'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = world.mode === 'flappy' ? '#eadcf9' : '#d4f5ec';
  for (let i = 0; i < 6; i++) {
    const drift = reduceMotion ? 0 : now * 0.004;
    const x = ((i * 137 - drift) % 540 + 540) % 540 - 60;
    ctx.beginPath(); ctx.ellipse(x, 80 + i * 73 % 300, 65, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  const self = world.players.find((p) => p.id === selfId) || world.players.find((p) => p.alive) || world.players[0];
  if (world.mode === 'flappy') {
    for (const pipe of world.pipes) {
      cucumber(ctx, pipe.x, -20, pipe.gap + 20);
      cucumber(ctx, pipe.x, pipe.gap + 185, HEIGHT - pipe.gap - 185);
    }
    rounded(ctx, -10, HEIGHT - 20, WIDTH + 20, 35, 0, '#ffad70');
    ctx.fillStyle = '#171229'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left'; ctx.fillText('the cucumber industrial complex', 16, HEIGHT - 7);
    for (const player of world.players.filter((p) => p.id !== selfId)) cat(ctx, player, player.y, false);
    if (self) cat(ctx, self, self.y, true);
  } else {
    const camera = Math.min(0, (self?.bestY ?? 480) - 245);
    for (const pad of world.platforms) {
      const y = pad.y - camera;
      if (y < -20 || y > HEIGHT + 20) continue;
      rounded(ctx, pad.x, y, pad.width, 13, 5, pad.index % 4 === 0 ? '#ffad70' : '#fff4d6');
      if (pad.index % 4 === 0 && pad.index > 0) {
        ctx.fillStyle = '#171229'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText(['toast', 'loaf', 'beanz'][pad.index % 3], pad.x + pad.width / 2, y + 10);
      }
    }
    for (const player of world.players.filter((p) => p.id !== selfId)) cat(ctx, player, player.y - camera, false);
    if (self) cat(ctx, self, self.y - camera, true);
    if (self && self.bestY < -100) {
      ctx.fillStyle = '#17122999'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText(self.score > 150 ? 'ground privileges revoked' : 'the floor misses you', WIDTH / 2, HEIGHT - 28);
    }
  }
  if (world.phase === 'countdown') {
    ctx.fillStyle = '#17122999'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center'; ctx.fillStyle = '#ddff45'; ctx.font = '800 100px "Bricolage Grotesque", sans-serif';
    ctx.fillText(String(Math.ceil(world.countdown)), WIDTH / 2, HEIGHT / 2 + 30);
    ctx.fillStyle = '#fff4d6'; ctx.font = 'bold 17px "Bricolage Grotesque", sans-serif'; ctx.fillText('prepare your one brain cell', WIDTH / 2, HEIGHT / 2 + 65);
  }
}
