import { createGame, applyInput, applyPlan, stepGame } from './game-core.js';
import { drawGame } from './game-render.js';
import { createBonkUI } from './bonk-ui.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const modeButtons = [...document.querySelectorAll('[data-game]')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const modeNames = { flappy: 'Flappy Mjav', jump: 'Boing Boing', dodge: 'Honk Dodge', bonk: 'Bonk Club' };
const instructions = {
  flappy: 'Tap the game or press Space to flap. Avoid the cucumbers. They know what you did.',
  jump: 'Bounce automatically across smaller toast. Steer with ← →, A / D, or the big buttons before the floor catches up.',
  dodge: 'Steer left and right. The geese fall faster every second. Do not become bread.',
  bonk: 'Move one tile (diagonals too), then aim a fish or shield. Fish hit the target and its four neighbours, even you. Lock within 8 seconds; everyone reveals together. 3 hearts. 2 shields.',
};
let mode = 'flappy';
let world = createGame(mode, [{ id: 'solo', name: 'You' }], 12345);
let running = false;
let paused = false;
let socket;
let selfId = 'solo';
let room;
let connecting = false;
let sharedView = true;
let retryTimer;
let retryDelay = 1000;
let pageGone = false;
let stageSounds = [];
let roomAudio = false;
let lastFrame = 0;
let lastSound = 0;
let direction = 0;
let lastNetworkInput = 0;
let lastSnapshot = 0;
let previousJumps = 0;
let gameOverHandled = false;
let rosterSignature = '';
let arenaVisible = true;
new IntersectionObserver(([entry]) => { arenaVisible = entry.isIntersecting; }).observe(canvas);

let best = {};
try { best = JSON.parse(localStorage.getItem('mjav-best') || '{}') || {}; } catch { best = {}; }

function sound(kind) { window.dispatchEvent(new CustomEvent('cat:game-sound', { detail: { kind } })); }
function setText(id, value) { const node = $(id); if (node.textContent !== value) node.textContent = value; }
function setPlayState(text, disabled) {
  for (const id of ['quick-play', 'overlay-play']) { $(id).disabled = disabled; setText(id, text); }
}
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function me() { return world?.players.find((player) => player.id === (sharedView ? selfId : 'solo')); }
function active() { return running && !paused && world?.phase === 'playing' && me()?.alive; }
function setMessage(text) { $('room-status').textContent = text; }
function focusGame() {
  (mode === 'bonk' ? canvas.closest('.game-viewport') : canvas.closest('.game-machine')).scrollIntoView({ block: mode === 'bonk' ? 'start' : 'center', behavior: 'auto' });
  canvas.focus({ preventScroll: true });
}

const bonk = createBonkUI({
  getWorld: () => world, getPlayer: me, isPaused: () => paused, sound,
  submit: (plan) => {
    if (sharedView) send({ type: 'plan', ...plan });
    else bonk.ack({ ...plan, accepted: applyPlan(world, 'solo', plan) });
  },
});
function recordBest() {
  const score = me()?.score || 0;
  if (score <= (Number(best[mode]) || 0)) return;
  best[mode] = score;
  $('best-score').textContent = String(score);
  try { localStorage.setItem('mjav-best', JSON.stringify(best)); } catch { /* Personal bests are optional. */ }
}

function updateMode(value) {
  mode = value;
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.game === mode));
  $('game-title').textContent = modeNames[mode];
  $('game-instructions').textContent = instructions[mode];
  $('game-help').textContent = instructions[mode];
  $('flap-control').hidden = mode !== 'flappy';
  $('steer-controls').hidden = !['jump', 'dodge'].includes(mode);
  document.querySelector('.game-controls').hidden = mode === 'bonk';
  (mode === 'bonk' ? $('bonk-status-row') : document.querySelector('.game-controls')).append($('pause-game'));
  canvas.setAttribute('aria-label', mode === 'bonk' ? 'Bonk Club. Use the map tile buttons to move and aim your fish.' : 'Cat arcade game. Flap with Space, or steer with the arrow keys. Touch controls are below.');
  $('practice-solo').textContent = mode === 'bonk' ? 'practice vs bots' : 'practice solo';
  $('best-score').textContent = String(best[mode] || 0);
}

function showOverlay(title, description) {
  $('game-overlay').hidden = false;
  $('game-title').textContent = title;
  $('game-instructions').textContent = description;
  $('solo-start').hidden = false;
  $('solo-start').textContent = !sharedView && gameOverHandled ? 'again. obviously.' : mode === 'bonk' ? 'practice vs bots' : 'play solo';
}

function startSolo() {
  send({ type: 'queue', join: false });
  send({ type: 'retire' });
  sharedView = false;
  $('watch-global').hidden = false;
  $('pause-game').disabled = false;
  for (const button of modeButtons) button.disabled = false;
  const roster = [{ id: 'solo', name: 'You' }];
  if (mode === 'bonk') roster.push({ id: 'bot-1', name: 'Bot Sardine', bot: true }, { id: 'bot-2', name: 'Bot Loaf', bot: true });
  world = createGame(mode, roster, crypto.getRandomValues(new Uint32Array(1))[0]);
  running = true; paused = false; gameOverHandled = false; previousJumps = 0;
  $('game-overlay').hidden = true;
  $('pause-game').textContent = 'pause';
  $('game-state').textContent = 'solo cat';
  direction = 0;
  if (room) updateRoster();
  focusGame();
  sound('blep');
}

function finish() {
  if (gameOverHandled) return;
  gameOverHandled = true;
  const score = me()?.score || 0;
  best[mode] = Math.max(Number(best[mode]) || 0, score);
  try { localStorage.setItem('mjav-best', JSON.stringify(best)); } catch { /* Personal bests are optional. */ }
  $('best-score').textContent = String(best[mode]);
  $('game-state').textContent = 'cat.exe has stopped';
  if (world.mode === 'bonk') {
    const winners = world.players.filter((player) => world.winners.includes(player.id));
    const won = winners.some((player) => player.id === (sharedView ? selfId : 'solo'));
    showOverlay(!winners.length ? 'mutually assured mjav.' : winners.length > 1 ? 'shared custody of the brain cell.' : won ? 'you won the catfight.' : `${winners[0].name} owns the brain cell.`, !winners.length ? 'Every cat got bonked. Nobody wins this very serious sport.' : `${winners.map((player) => player.name).join(' & ')}: ${winners[0].hp} hearts, ${winners[0].score} hits. Most hearts wins; hits break ties.`);
    if (me()) sound(won ? 'ascend' : 'bonk');
    return;
  }
  const winner = [...world.players].sort((a, b) => b.score - a.score || b.survived - a.survived)[0];
  const title = mode === 'flappy' ? 'outplayed by a vegetable.' : mode === 'jump' ? 'gravity remains undefeated.' : 'the geese won.';
  const soloScore = mode === 'dodge' ? `${(score / 10).toFixed(1)} seconds of goose denial` : `${score} ${mode === 'flappy' ? 'cucumbers escaped' : 'metres of bad decisions'}`;
  showOverlay(title, sharedView ? `${winner.name} leads with ${winner.score} points. Tap play together for another round.` : `${soloScore}. Your cat requests a rematch.`);
  if (me()) sound('bonk');
}

function input(next) {
  if (!active()) return;
  applyInput(world, sharedView ? selfId : 'solo', next);
  if (sharedView) send({ type: 'input', ...next });
  if (next.flap && performance.now() - lastSound > 160) { sound('blep'); lastSound = performance.now(); }
}
function steer(value) { direction = value; input({ direction: value }); }
function flap() { if (mode === 'flappy') input({ flap: true }); }

function render(time) {
  const dt = Math.min((time - (lastFrame || time)) / 1000, 0.05);
  lastFrame = time;
  if (running && !paused && !(sharedView && world.mode === 'bonk') && (!sharedView || performance.now() - lastSnapshot < 150)) {
    const steps = Math.max(1, Math.ceil(dt * 60));
    for (let i = 0; i < steps; i++) stepGame(world, dt / steps);
  }
  if (sharedView && active() && ['jump', 'dodge'].includes(mode) && time - lastNetworkInput > 100) { send({ type: 'input', direction }); lastNetworkInput = time; }
  const player = me();
  if (player) {
    setText('current-score', String(player.score));
    recordBest();
    if (player.jumps > previousJumps && time - lastSound > 200) { sound('boing'); lastSound = time; }
    previousJumps = player.jumps;
    if (sharedView && !player.alive && world.phase !== 'over') setText('game-state', 'you bonked · spectating');
  }
  if (running && world.phase === 'over' && !sharedView) finish();
  bonk.update();
  if (arenaVisible && !document.hidden) drawGame(ctx, world, sharedView ? selfId : 'solo', time, reduced.matches, world.mode === 'bonk' && me() ? bonk.draft() : undefined);
  requestAnimationFrame(render);
}

modeButtons.forEach((button) => button.addEventListener('click', () => {
  if (sharedView && world?.phase !== 'over' && running) return;
  updateMode(button.dataset.game);
  if (!sharedView) {
    world = createGame(mode, [{ id: 'solo', name: 'You' }], 12345);
    running = false; paused = false; gameOverHandled = false;
    showOverlay(modeNames[mode], instructions[mode]);
  } else showLobby();
  if (room) updateRoster();
}));
$('solo-start').addEventListener('click', startSolo);
$('practice-solo').addEventListener('click', startSolo);
$('pause-game').addEventListener('click', () => {
  if (sharedView || !running || world.phase === 'over') return;
  paused = !paused;
  $('pause-game').textContent = paused ? 'resume' : 'pause';
  $('game-state').textContent = paused ? 'cat nap · paused' : 'solo cat';
});
canvas.addEventListener('pointerdown', (event) => { event.preventDefault(); canvas.focus({ preventScroll: true }); flap(); });
$('flap-control').addEventListener('pointerdown', (event) => { event.preventDefault(); flap(); });
$('flap-control').addEventListener('click', (event) => { if (event.detail === 0) flap(); });
for (const [id, value] of [['steer-left', -1], ['steer-right', 1]]) {
  $(id).addEventListener('pointerdown', (event) => { event.preventDefault(); $(id).setPointerCapture(event.pointerId); steer(value); });
  $(id).addEventListener('pointerup', () => steer(0));
  $(id).addEventListener('pointercancel', () => steer(0));
  $(id).addEventListener('lostpointercapture', () => steer(0));
  $(id).addEventListener('click', (event) => {
    if (event.detail === 0) { steer(value); setTimeout(() => steer(0), 180); }
  });
}
document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, [contenteditable]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape' && !sharedView && running && world.phase !== 'over') {
    paused = true; $('pause-game').textContent = 'resume'; $('game-state').textContent = 'cat nap · paused';
  }
  if (event.target.closest('button, a') || !active() || ![' ', 'ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === ' ' && !event.repeat) flap();
  if (['ArrowLeft', 'a', 'A'].includes(event.key)) steer(-1);
  if (['ArrowRight', 'd', 'D'].includes(event.key)) steer(1);
});
document.addEventListener('keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(event.key)) steer(0); });
window.addEventListener('blur', () => steer(0));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  steer(0);
  if (!sharedView && running) { paused = true; $('pause-game').textContent = 'resume'; $('game-state').textContent = 'cat nap · paused'; }
});

function updateRoster() {
  const race = room.world && room.world.phase !== 'over';
  const priority = [...room.players].sort((a, b) => (b.id === selfId) - (a.id === selfId));
  // Reuse list nodes on world frames. Only membership/queue/round changes rebuild it.
  const signature = JSON.stringify([priority, room.queue, Boolean(race), room.world?.round, room.world?.players.map(({ id, color }) => [id, color])]);
  const rebuild = signature !== rosterSignature;
  if (rebuild) { rosterSignature = signature; $('room-roster').replaceChildren(); }
  let index = 0;
  for (const player of priority.slice(0, 12)) {
    const avatar = room.world?.players.find((p) => p.id === player.id);
    let row = $('room-roster').children[index++];
    if (rebuild) {
      row = document.createElement('li');
      const label = document.createElement('span'); label.textContent = `${player.name}${player.id === selfId ? ' (you)' : ''}`;
      const badge = document.createElement('i'); badge.setAttribute('aria-hidden', 'true');
      badge.style.backgroundColor = race && avatar ? avatar.color : player.color;
      row.append(badge, label, document.createElement('strong'));
      $('room-roster').append(row);
    }
    const queued = room.queue.indexOf(player.id);
    const text = queued >= 0 ? `queue #${queued + 1}` : avatar && race ? `${avatar.score}${avatar.alive ? ' racing' : ' ☠'}` : 'loafing';
    if (row.lastChild.textContent !== text) row.lastChild.textContent = text;
  }
  if (rebuild && room.players.length > 12) {
    const more = document.createElement('li'); more.textContent = `+ ${room.players.length - 12} more cats in the audience`; $('room-roster').append(more);
  }
  const queued = room.queue.includes(selfId);
  const waiting = room.waitingMode === 'bonk';
  const participant = race && room.world.players.some((p) => p.id === selfId && p.alive);
  const canJoin = race && room.world.phase === 'countdown' && room.world.countdown > 0.5 && room.world.players.length < 8 && !room.world.players.some((p) => p.id === selfId);
  $('room-queue').hidden = !queued;
  setPlayState(queued ? waiting ? 'waiting for a rival…' : `queued · #${room.queue.indexOf(selfId) + 1}` : sharedView && participant ? (room.world.phase === 'countdown' ? 'you’re in. get ready!' : room.world.mode === 'bonk' ? 'catfight in progress' : 'you’re racing!') : canJoin ? 'join this round' : waiting ? 'join the catfight' : race ? 'play next round' : 'play together', Boolean(queued || (sharedView && participant)));
  for (const button of modeButtons) button.disabled = sharedView && Boolean(race || waiting);
  setText('room-count', `${room.players.length} ${room.players.length === 1 ? 'cat' : 'cats'} online`);
  setText('queue-status', waiting ? 'Bonk Club needs 2 humans. One cat is waiting. Join them!' : queued ? 'You’ll join the next countdown automatically.' : participant && sharedView ? `${room.world.players.length}/8 cats in this round. Good luck, tiny beast.` : race ? `${modeNames[room.world.mode]} is on. ${room.queue.length} waiting for the next round.` : mode === 'bonk' ? 'One global map. 2–8 humans. Bots only in practice.' : `One global room. Up to 8 cats. Starts with one tap.`);
}

function showLobby() {
  running = false; paused = false; gameOverHandled = false;
  world = createGame(mode, [], 12345);
  $('current-score').textContent = '0';
  $('game-state').textContent = room ? 'global cat lobby' : 'connecting to the cats';
  showOverlay(modeNames[mode], instructions[mode]);
}

function sharedWorld(next) {
  if (!sharedView) return;
  if (room?.waitingMode === 'bonk') { updateMode('bonk'); showLobby(); return; }
  if (!next) { showLobby(); return; }
  const newRound = world.round !== next.round;
  const joining = !me() && next.players.some((player) => player.id === selfId);
  world = next; lastSnapshot = performance.now(); running = true; paused = false;
  if (newRound || (world.phase !== 'over' && mode !== world.mode)) updateMode(world.mode);
  if (newRound) {
    previousJumps = 0; gameOverHandled = false;
  }
  // Only a cat that opted into this race gets pulled to the game.
  if ((newRound || joining) && me() && world.phase === 'countdown') { direction = 0; focusGame(); }
  if (world.phase === 'over') finish();
  else {
    $('game-overlay').hidden = true;
    setText('game-state', !me() ? 'spectating the cats' : !me().alive ? 'you bonked · spectating' : world.phase === 'countdown' ? 'get your paws ready' : world.mode === 'bonk' ? 'global catfight' : 'global cat race');
  }
}

function watchGlobal() {
  sharedView = true; paused = false;
  // Force the overlay to reset when returning from a solo round.
  world = createGame(mode, [], 12345);
  world.round = '';
  $('watch-global').hidden = true; $('pause-game').disabled = true;
  sharedWorld(room?.world);
  if (room) updateRoster();
}

const faces = { mjav: ':3', prrr: '≋', blep: ':P', yap: '!!!', eepy: 'zz', ufo: '⊙', honk: '!?', bonk: '×', boing: '⌁', ascend: '✧' };
function renderStage() {
  const latest = stageSounds.at(-1);
  $('stage-face').textContent = latest ? faces[latest.sound] || ':3' : ':3';
  $('stage-now').textContent = latest ? `${latest.name} dropped a ${latest.sound}` : 'the microphone is covered in fur.';
  const list = $('sound-stage-list');
  const visible = stageSounds.slice(-6);
  const keys = new Set(visible.map((item) => item.key));
  for (const row of [...list.children]) if (!keys.has(row.dataset.key)) row.remove();
  for (const item of visible) {
    if ([...list.children].some((row) => row.dataset.key === item.key)) continue;
    const row = document.createElement('li');
    row.dataset.key = item.key;
    const text = document.createElement('span'); text.textContent = `${item.name}${item.id === selfId ? ' (you)' : ''} · ${item.sound}`;
    const echo = document.createElement('button'); echo.type = 'button'; echo.textContent = 'echo ↗';
    echo.setAttribute('aria-label', `Echo ${item.sound} by ${item.name}`);
    echo.addEventListener('click', () => window.dispatchEvent(new CustomEvent('cat:perform', { detail: { kind: item.sound } })));
    row.append(text, echo); list.prepend(row);
  }
}

function joinGlobal() {
  if (pageGone || connecting || socket?.readyState === WebSocket.OPEN) return;
  clearTimeout(retryTimer);
  connecting = true;
  setMessage('Calling the global brain cell…');
  const url = new URL('/api/room', location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(url); socket = current;
  let lastSeen = Date.now();
  const timeout = setTimeout(() => lost(), 10000);
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > 45000) lost();
    else if (current.readyState === WebSocket.OPEN) current.send('ping');
  }, 20000);
  function lost() {
    clearTimeout(timeout); clearInterval(heartbeat);
    if (socket !== current) return;
    socket = undefined; connecting = false; room = undefined;
    current.close();
    $('room-count').textContent = 'reconnecting…';
    $('room-queue').hidden = true;
    setPlayState('reconnecting…', true);
    $('room-roster').replaceChildren();
    rosterSignature = '';
    $('queue-status').textContent = 'Rejoin the race queue after reconnecting.';
    if (sharedView) showLobby();
    setMessage('Cat phone disconnected. Reconnecting automatically… Solo still works.');
    if (!pageGone) {
      retryTimer = setTimeout(joinGlobal, retryDelay + Math.random() * 400);
      retryDelay = Math.min(15000, retryDelay * 2);
    }
  }
  current.addEventListener('message', (event) => {
    if (socket !== current) return;
    lastSeen = Date.now();
    if (event.data === 'pong') return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'welcome') {
      selfId = data.id; stageSounds = data.sounds || []; renderStage(); return;
    }
    if (data.type === 'state') {
      const first = !room;
      room = data;
      if (first) {
        connecting = false; retryDelay = 1000; clearTimeout(timeout);
        setMessage('You are in the global lobby. Soundboard presses go to everyone.');
      }
      sharedWorld(data.world);
      updateRoster();
    } else if (data.type === 'frame' && room) {
      room.world = data.world;
      sharedWorld(data.world);
      updateRoster();
    } else if (data.type === 'plan-ack') {
      bonk.ack(data);
    } else if (data.type === 'reaction') {
      stageSounds = [...stageSounds, data].slice(-12); renderStage();
      $('room-reaction').textContent = `${data.name}: ${data.sound}!`;
      if (roomAudio && data.id !== selfId && !document.hidden) sound(data.sound);
    } else if (data.type === 'notice') setMessage(data.text);
  });
  current.addEventListener('close', lost);
  current.addEventListener('error', lost);
}
$('room-queue').addEventListener('click', () => {
  send({ type: 'queue', join: false });
});
$('quick-play').addEventListener('click', () => {
  if (!room) return;
  const selected = mode;
  if (!sharedView) watchGlobal();
  setPlayState('joining the cats…', true);
  send({ type: 'play', mode: selected });
  sound('blep');
});
$('overlay-play').addEventListener('click', () => $('quick-play').click());
document.querySelectorAll('[data-reaction]').forEach((button) => button.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('cat:perform', { detail: { kind: button.dataset.reaction } }));
}));
$('watch-global').addEventListener('click', watchGlobal);
$('room-audio').addEventListener('change', () => { roomAudio = $('room-audio').checked; if (roomAudio) sound('blep'); });
window.addEventListener('cat:reaction', (event) => { if (room) send({ type: 'reaction', sound: event.detail.kind }); });
window.addEventListener('online', joinGlobal);
window.addEventListener('pagehide', () => { pageGone = true; clearTimeout(retryTimer); socket?.close(1000, 'Cat left'); });
window.addEventListener('pageshow', () => { pageGone = false; joinGlobal(); });

updateMode(mode); showLobby(); $('pause-game').disabled = true;
setPlayState('connecting…', true);
requestAnimationFrame(render);
const url = new URL(location.href);
if (url.searchParams.has('room')) { url.searchParams.delete('room'); history.replaceState(null, '', url); }
joinGlobal();
