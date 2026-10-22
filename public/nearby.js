import { NearbyPeer } from './nearby-peer.js';
import { NearbyGame } from './nearby-game.js';
import { createGame } from './game-core.js';
import { drawGame } from './game-render.js';
import { createBonkUI } from './bonk-ui.js';

const $ = (id) => document.getElementById(id);
let action = 0;
let game, world = createGame('bonk', [], 1), scanning = false, scanGeneration = 0, camera, scanTimer;
const context = $('game-canvas').getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const bonk = createBonkUI({ getWorld: () => world, getPlayer: () => world.players.find((p) => p.id === peer.role), isPaused: () => peer.status !== 'connected', submit: (plan) => game?.plan(plan), sound: () => {} });
const peer = new NearbyPeer({
  onStatus(status, detail) {
    $('pair-status').textContent = detail || 'First phone: make a code. Second phone: scan it.';
    $('make-code').hidden = !['idle', 'disconnected'].includes(status);
    $('pair-again').hidden = status === 'idle';
    $('scan-code').hidden = !['idle', 'offer', 'disconnected'].includes(status);
    $('nearby-play').disabled = status !== 'connected';
    $('use-code').disabled = !['idle', 'offer', 'disconnected'].includes(status);
    if (status === 'connected') {
      stopScan(); $('qr-panel').hidden = true; $('text-pairing').open = false;
      $('nearby-arena').hidden = false; $('nearby-arena').scrollIntoView({ block: 'start', behavior: 'auto' }); $('nearby-seat').textContent = peer.role === 'host' ? 'You are Cat Sardine' : 'You are Cat Loaf';
    }
    if (status === 'disconnected' || status === 'idle') {
      game = null; stopScan(); $('qr-panel').hidden = true;
      $('out-code').value = ''; $('in-code').value = '';
      $('round-status').textContent = status === 'disconnected' ? 'Connection dropped. Pair again to play.' : 'Waiting for both cats.';
    }
    bonk.update();
  },
  onOpen() {
    world = createGame('bonk', [], 1); bonk.update();
    game = new NearbyGame({ role: peer.role, send: (message) => peer.send(message), onWorld: (next) => { if (peer.status === 'connected') updateWorld(next); }, onAck: (ack) => { if (world.players.length) bonk.ack(ack); } });
    $('nearby-play').textContent = 'ready to bonk'; $('nearby-play').disabled = false;
    $('round-status').textContent = 'Both cats: tap ready to bonk.';
  },
  onMessage(message) { game?.receive(message); },
});

function updateWorld(next) {
  world = next;
  $('round-status').textContent = world.phase === 'over' ? `Round over. ${world.winners.length === 2 ? 'A draw!' : world.winners.length ? `${world.players.find((p) => p.id === world.winners[0]).name} wins!` : 'Both cats got bonked!'}` : world.phase === 'countdown' ? `Starting in ${Math.ceil(world.countdown)}…` : 'Nearby catfight';
  if (world.phase === 'over') { $('nearby-play').textContent = 'ready for a rematch'; $('nearby-play').disabled = game.ready; }
  else $('nearby-play').disabled = true;
  bonk.update();
}
function showCode(text) {
  if (!text || !['offer', 'answer'].includes(peer.status)) return;
  const qr = globalThis.qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const count = qr.getModuleCount(), scale = 6, margin = 4;
  const canvas = $('pair-qr'); canvas.width = canvas.height = (count + margin * 2) * scale;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  $('out-code').value = text; $('qr-panel').hidden = false;
  $('qr-title').textContent = peer.role === 'host' ? '1. Friend scans this code.' : '2. First phone scans this reply.';
  $('qr-hint').textContent = peer.role === 'host' ? 'On the second phone, tap scan friend’s code. Then scan their reply here.' : 'On the first phone, tap scan friend’s code again. Keep this reply visible.';
  $('qr-panel').scrollIntoView({ block: 'start', behavior: 'auto' });
}
async function useCode(text) {
  const token = ++action;
  $('use-code').disabled = true;
  try {
    $('scan-status').textContent = '';
    const result = await peer.accept(text.trim());
    if (token !== action) return;
    stopScan(); showCode(result);
  } catch (error) {
    if (token !== action) return;
    $('scan-status').textContent = error.message;
    // Invalid codes can be rescanned. A partially constructed peer must be reset.
    if (peer.status === 'gathering' || peer.status === 'connecting') peer.fail('Pairing failed. Tap pair again and try the current code.');
    if (peer.status === 'disconnected') stopScan();
  } finally {
    if (token === action) $('use-code').disabled = !['idle', 'offer', 'disconnected'].includes(peer.status);
  }
}
$('make-code').addEventListener('click', async () => {
  const token = ++action;
  try { $('scan-status').textContent = ''; const code = await peer.host(); if (token === action) showCode(code); }
  catch (error) { if (token === action) { $('scan-status').textContent = error.message; peer.fail('Could not make a code. Pair again.'); } }
});
$('pair-again').addEventListener('click', () => {
  action++; peer.close(); world = createGame('bonk', [], 1); bonk.update();
  $('nearby-arena').hidden = true; $('scan-status').textContent = '';
});
$('use-code').addEventListener('click', () => useCode($('in-code').value));
$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('out-code').value); $('scan-status').textContent = 'Code copied.'; }
  catch { $('out-code').focus(); $('out-code').select(); $('scan-status').textContent = 'Select and copy the code above.'; }
});
$('nearby-play').addEventListener('click', () => {
  game?.play(); $('nearby-play').disabled = true;
  $('round-status').textContent = 'Ready. Waiting for the other cat…';
});
function stopScan() {
  scanning = false; scanGeneration++; clearTimeout(scanTimer);
  camera?.getTracks().forEach((track) => track.stop()); camera = null;
  $('scan-video').srcObject = null; $('scanner').hidden = true;
}
$('stop-scan').addEventListener('click', stopScan);
$('scan-code').addEventListener('click', async () => {
  stopScan(); const generation = scanGeneration;
  try {
    $('scan-status').textContent = 'Opening the rear camera…';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 960 }, height: { ideal: 960 } }, audio: false });
    if (generation !== scanGeneration) { stream.getTracks().forEach((track) => track.stop()); return; }
    camera = stream; scanning = true;
    const video = $('scan-video'); $('scanner').hidden = false; $('scanner').scrollIntoView({ block: 'start', behavior: 'auto' }); video.srcObject = camera; await video.play();
    $('scan-status').textContent = 'Looking for your friend’s code…';
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    function scan() {
      if (!scanning || generation !== scanGeneration) return;
      if (video.readyState >= 2) {
        const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = globalThis.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' });
        if (result?.data.startsWith('MJAV1:')) { stopScan(); void useCode(result.data); return; }
      }
      scanTimer = setTimeout(scan, 250);
    }
    scan();
  } catch { stopScan(); $('scan-status').textContent = 'Camera unavailable. Allow camera access over HTTPS, or paste your friend’s code below.'; }
});
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
  if (peer.status === 'connected') game?.tick(dt);
}, 250);
function paint(time) {
  if (!document.hidden && !$('nearby-arena').hidden) drawGame(context, world, peer.role, time, reduced.matches, bonk.draft());
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);
window.addEventListener('pagehide', () => { stopScan(); peer.close(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });

async function saveOffline() {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('No service worker');
    await navigator.serviceWorker.register('/nearby-sw.js');
    await navigator.serviceWorker.ready;
    // Installation finishes only after every asset is cached.
    $('offline-ready').textContent = 'Saved for offline play on this phone. Bookmark this page.';
  } catch { $('offline-ready').textContent = 'Could not save for offline play. Reconnect to the internet and reload before leaving.'; }
}
void saveOffline();
