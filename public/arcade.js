import { createGame, applyInput, stepGame } from './game-core.js';
import { drawGame } from './game-render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const modeButtons = [...document.querySelectorAll('[data-game]')];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const modeNames = { flappy: 'Flappy Mjav', jump: 'Boing Boing' };
const instructions = {
  flappy: 'Tap the game or press Space to flap. Avoid the cucumbers. They know what you did.',
  jump: 'Bounce automatically. Steer with ← →, A / D, or the big buttons. The floor is a suggestion.',
};
let mode = 'flappy';
let world = createGame(mode, [{ id: 'solo', name: 'You' }], 12345);
let running = false;
let paused = false;
let socket;
let selfId = 'solo';
let room;
let connecting = false;
let roomAudio = false;
let lastFrame = 0;
let lastSound = 0;
let direction = 0;
let lastNetworkInput = 0;
let lastSnapshot = 0;
let previousJumps = 0;
let gameOverHandled = false;
let reactionTimer;
let best = {};
try { best = JSON.parse(localStorage.getItem('mjav-best') || '{}') || {}; } catch { best = {}; }

function sound(kind) { window.dispatchEvent(new CustomEvent('cat:game-sound', { detail: { kind } })); }
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); }
function me() { return world?.players.find((player) => player.id === selfId); }
function active() { return running && !paused && world?.phase === 'playing' && me()?.alive; }
function setMessage(text) { $('room-status').textContent = text; }
function focusGame() {
  canvas.closest('.game-machine').scrollIntoView({ block: 'center', behavior: 'auto' });
  canvas.focus({ preventScroll: true });
}
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
  $('steer-controls').hidden = mode !== 'jump';
  $('best-score').textContent = String(best[mode] || 0);
}

function showOverlay(title, description) {
  $('game-overlay').hidden = false;
  $('game-title').textContent = title;
  $('game-instructions').textContent = description;
  $('solo-start').hidden = Boolean(room);
  $('solo-start').textContent = gameOverHandled ? 'again. obviously.' : 'play solo';
}

function startSolo() {
  if (room) return;
  selfId = 'solo';
  world = createGame(mode, [{ id: selfId, name: 'You' }], crypto.getRandomValues(new Uint32Array(1))[0]);
  running = true; paused = false; gameOverHandled = false; previousJumps = 0;
  $('game-overlay').hidden = true;
  $('pause-game').textContent = 'pause';
  $('game-state').textContent = 'solo cat';
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
  const winner = [...world.players].sort((a, b) => b.score - a.score || b.survived - a.survived)[0];
  const title = mode === 'flappy' ? 'outplayed by a vegetable.' : 'gravity remains undefeated.';
  showOverlay(title, room ? `${winner.name} leads with ${winner.score}. The host can start another round.` : `${score} ${mode === 'flappy' ? 'cucumbers escaped' : 'metres of bad decisions'}. Your cat requests a rematch.`);
  sound('bonk');
}

function input(next) {
  if (!active()) return;
  applyInput(world, selfId, next);
  if (room) send({ type: 'input', ...next });
  if (next.flap && performance.now() - lastSound > 160) { sound('blep'); lastSound = performance.now(); }
}
function steer(value) { direction = value; input({ direction: value }); }
function flap() { if (mode === 'flappy') input({ flap: true }); }

function render(time) {
  const dt = Math.min((time - (lastFrame || time)) / 1000, 0.05);
  lastFrame = time;
  if (running && !paused && (!room || performance.now() - lastSnapshot < 150)) {
    const steps = Math.max(1, Math.ceil(dt * 60));
    for (let i = 0; i < steps; i++) stepGame(world, dt / steps);
  }
  if (room && active() && mode === 'jump' && time - lastNetworkInput > 100) { send({ type: 'input', direction }); lastNetworkInput = time; }
  const player = me();
  if (player) {
    $('current-score').textContent = String(player.score);
    recordBest();
    if (player.jumps > previousJumps && time - lastSound > 200) { sound('boing'); lastSound = time; }
    previousJumps = player.jumps;
    if (room && !player.alive && world.phase !== 'over') $('game-state').textContent = 'you bonked · spectating';
  }
  if (running && world.phase === 'over' && !room) finish();
  drawGame(ctx, world, selfId, time, reduced.matches);
  requestAnimationFrame(render);
}

modeButtons.forEach((button) => button.addEventListener('click', () => {
  if (room && world?.phase !== 'over' && running) return;
  updateMode(button.dataset.game);
  if (!room) {
    world = createGame(mode, [{ id: 'solo', name: 'You' }], 12345);
    running = false; paused = false; gameOverHandled = false;
    showOverlay(modeNames[mode], instructions[mode]);
  }
}));
$('solo-start').addEventListener('click', startSolo);
$('pause-game').addEventListener('click', () => {
  if (room || !running || world.phase === 'over') return;
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
  if (event.key === 'Escape' && !room && running && world.phase !== 'over') {
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
  if (!room && running) { paused = true; $('pause-game').textContent = 'resume'; $('game-state').textContent = 'cat nap · paused'; }
});

function updateRoster() {
  const fragment = document.createDocumentFragment();
  for (const player of room.players) {
    const row = document.createElement('li');
    const label = document.createElement('span'); label.textContent = `${player.name}${player.id === selfId ? ' (you)' : ''}`;
    const badge = document.createElement('i'); badge.style.backgroundColor = player.color; badge.setAttribute('aria-hidden', 'true');
    const score = document.createElement('strong');
    const avatar = room.world?.players.find((p) => p.id === player.id);
    score.textContent = avatar ? `${avatar.score}${avatar.alive ? '' : ' ☠'}` : player.id === room.hostId ? 'host' : 'ready';
    row.append(badge, label, score); fragment.append(row);
  }
  $('room-roster').replaceChildren(fragment);
  $('room-start').hidden = room.hostId !== selfId;
  $('room-start').disabled = Boolean(room.world && room.world.phase !== 'over');
  for (const button of modeButtons) button.disabled = room.hostId !== selfId || Boolean(room.world && room.world.phase !== 'over');
  $('room-start').textContent = room.world?.phase === 'over' ? 'start another round' : `start ${modeNames[mode]}`;
  $('room-count').textContent = `${room.players.length}/8 cats`;
}

function connectedUI(code) {
  running = false; paused = false; gameOverHandled = false;
  world = createGame(mode, [{ id: selfId, name: 'You' }], 12345);
  $('game-state').textContent = 'cat council lobby';
  $('room-connect').hidden = true;
  $('room-connected').hidden = false;
  $('room-code').textContent = code;
  const url = new URL(location.href); url.searchParams.set('room', code); url.hash = 'arcade';
  $('invite-link').value = url.href;
  history.replaceState(null, '', url);
  $('pause-game').disabled = true;
  showOverlay('the council is assembling.', 'Invite a friend, pick a game, then the host starts the round.');
  setMessage('Connected. Your cat name has been assigned by the universe.');
}

function leaveRoom(message = 'Room left. Solo cat privileges restored.') {
  const old = socket; socket = undefined; old?.close(1000, 'Cat left');
  room = undefined; connecting = false; selfId = 'solo'; running = false; paused = false;
  world = createGame(mode, [{ id: 'solo', name: 'You' }], 12345);
  $('room-connect').hidden = false; $('room-connected').hidden = true; $('pause-game').disabled = false;
  $('pause-game').textContent = 'pause'; $('game-state').textContent = 'solo cat';
  for (const button of modeButtons) button.disabled = false;
  $('create-room').disabled = false; $('join-room').disabled = false;
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url);
  gameOverHandled = false; showOverlay(modeNames[mode], instructions[mode]); setMessage(message);
}

async function joinRoom(code) {
  if (connecting || room) return;
  code = code.trim().toLowerCase();
  if (!/^[a-z0-9]{8}$/.test(code)) return setMessage('Room codes have eight letters or numbers.');
  connecting = true; $('create-room').disabled = true; $('join-room').disabled = true;
  setMessage('Calling the other brain cells…');
  const url = new URL(`/api/rooms/${code}`, location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(url); socket = current;
  const timeout = setTimeout(() => { if (connecting) leaveRoom('The cat phone timed out. Try joining again.'); }, 10000);
  current.addEventListener('message', (event) => {
    if (socket !== current || event.data === 'pong') return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'welcome') { selfId = data.id; return; }
    if (data.type === 'state') {
      const first = !room;
      room = data;
      if (first) { connecting = false; clearTimeout(timeout); connectedUI(code); }
      if (data.world) {
        const newRound = world.round !== data.world.round;
        world = data.world; lastSnapshot = performance.now(); running = true; paused = false;
        updateMode(world.mode);
        if (newRound) {
          previousJumps = 0; gameOverHandled = false;
          if (world.players.some((player) => player.id === selfId)) focusGame();
        }
        if (world.phase === 'over') finish();
        else {
          $('game-overlay').hidden = false;
          if (world.players.some((p) => p.id === selfId)) $('game-overlay').hidden = true;
          else showOverlay('front-row cat seat.', 'This round is already running. You join the next one.');
          $('game-state').textContent = world.phase === 'countdown' ? 'synchronising brain cells' : 'room race';
        }
      }
      updateRoster();
    } else if (data.type === 'reaction') {
      $('room-reaction').textContent = `${data.name}: ${data.sound}!`;
      clearTimeout(reactionTimer); reactionTimer = setTimeout(() => { $('room-reaction').textContent = ''; }, 2200);
      if (roomAudio && data.id !== selfId && !document.hidden) sound(data.sound);
    }
  });
  current.addEventListener('close', () => { clearTimeout(timeout); if (socket === current) leaveRoom('Connection closed. The room may be full or asleep. Rejoin to play again.'); });
  current.addEventListener('error', () => { clearTimeout(timeout); if (socket === current) leaveRoom('Could not join that room. Check the code or make a new one.'); });
}
$('create-room').addEventListener('click', async () => {
  if (connecting || room) return;
  $('create-room').disabled = true;
  setMessage('Building a small enclosure for your friends…');
  try {
    const response = await fetch('/api/rooms', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The room factory is taking a nap.');
    await joinRoom(data.code);
  } catch (error) { setMessage(error.message); $('create-room').disabled = false; }
});
$('join-form').addEventListener('submit', (event) => { event.preventDefault(); joinRoom($('join-code').value); });
$('room-leave').addEventListener('click', () => leaveRoom());
$('room-start').addEventListener('click', () => send({ type: 'start', mode }));
$('copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); setMessage('Link copied. Send it to your fellow unemployed cats.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); setMessage('Copy the selected room link and send it to a friend.'); }
});
$('room-audio').addEventListener('change', () => { roomAudio = $('room-audio').checked; if (roomAudio) sound('blep'); });
window.addEventListener('cat:reaction', (event) => { if (room) send({ type: 'reaction', sound: event.detail.kind }); });
window.addEventListener('pagehide', () => socket?.close(1000, 'Cat left'));

updateMode(mode); drawGame(ctx, world, selfId, 0, reduced.matches); requestAnimationFrame(render);
const invited = new URL(location.href).searchParams.get('room');
if (invited) { $('join-code').value = invited; setMessage('A cat invited you. Press join room when you are ready.'); }
