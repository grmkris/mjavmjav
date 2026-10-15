const buttons = [...document.querySelectorAll('[data-sound]')];
const catButton = document.querySelector('#cat-button');
const catStage = document.querySelector('#cat-stage');
const muteButton = document.querySelector('#mute-button');
const chaosButton = document.querySelector('#chaos-button');
const statusText = document.querySelector('#status-text');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const soundNames = {
  mjav: 'mjav', prrr: 'prrrrt', blep: 'blep', yap: 'YAP YAP', eepy: 'eepy',
  ufo: 'space cat', honk: 'honk', bonk: 'bonk', boing: 'boing', ascend: 'ascend',
};
const realMeow = new Audio('/meow.wav');
realMeow.preload = 'auto';
realMeow.volume = 0.55;

let audioContext;
let master;
let muted = false;
let chaosTimer;
let stageTimer;
let totalSounds = 0;
const playingTimers = new Map();
const activeOscillators = new Set();

function getAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) {
    audioContext = new Context();
    master = audioContext.createGain();
    master.gain.value = muted ? 0 : 0.65;
    const compressor = audioContext.createDynamicsCompressor();
    master.connect(compressor).connect(audioContext.destination);
  }
  audioContext.resume().catch(() => {});
  return audioContext;
}

function stopVoices() {
  realMeow.pause();
  for (const oscillator of activeOscillators) oscillator.stop();
  activeOscillators.clear();
}

function tone(context, { frequency, type = 'sine', duration = 0.22, start = 0, end = frequency, volume = 0.12 }) {
  if (activeOscillators.size >= 12) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  const time = context.currentTime + start;
  oscillator.frequency.setValueAtTime(frequency, time);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, end), time + duration);
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  oscillator.connect(gain).connect(master);
  activeOscillators.add(oscillator);
  oscillator.onended = () => {
    activeOscillators.delete(oscillator);
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(time);
  oscillator.stop(time + duration + 0.02);
}

function synthSound(kind) {
  const context = getAudio();
  if (!context) return;
  if (kind === 'mjav') {
    tone(context, { frequency: 520, end: 220, duration: 0.34, volume: 0.15 });
    tone(context, { frequency: 720, end: 340, duration: 0.25, start: 0.1, volume: 0.08 });
  }
  if (kind === 'prrr') {
    tone(context, { frequency: 105, end: 92, type: 'sawtooth', duration: 0.55, volume: 0.08 });
    tone(context, { frequency: 140, end: 118, type: 'square', duration: 0.45, start: 0.04, volume: 0.035 });
  }
  if (kind === 'blep') {
    tone(context, { frequency: 330, end: 560, type: 'triangle', duration: 0.16, volume: 0.13 });
    tone(context, { frequency: 520, end: 430, type: 'triangle', duration: 0.12, start: 0.13, volume: 0.11 });
  }
  if (kind === 'yap') {
    [0, 0.12, 0.24].forEach((start) => tone(context, { frequency: 720, end: 280, type: 'square', duration: 0.11, start, volume: 0.11 }));
  }
  if (kind === 'eepy') {
    tone(context, { frequency: 240, end: 110, type: 'sine', duration: 0.75, volume: 0.1 });
    tone(context, { frequency: 330, end: 150, type: 'triangle', duration: 0.55, start: 0.08, volume: 0.06 });
  }
  if (kind === 'ufo') {
    tone(context, { frequency: 180, end: 920, type: 'sine', duration: 0.55, volume: 0.1 });
    tone(context, { frequency: 920, end: 180, type: 'sine', duration: 0.55, start: 0.2, volume: 0.08 });
  }
  if (kind === 'honk') {
    tone(context, { frequency: 180, end: 130, type: 'square', duration: 0.16, volume: 0.16 });
    tone(context, { frequency: 150, end: 110, type: 'square', duration: 0.2, start: 0.16, volume: 0.14 });
  }
  if (kind === 'bonk') {
    tone(context, { frequency: 180, end: 58, type: 'triangle', duration: 0.28, volume: 0.18 });
  }
  if (kind === 'boing') {
    tone(context, { frequency: 180, end: 740, type: 'sine', duration: 0.28, volume: 0.14 });
    tone(context, { frequency: 460, end: 180, type: 'triangle', duration: 0.24, start: 0.08, volume: 0.09 });
  }
  if (kind === 'ascend') {
    [0, 0.1, 0.2, 0.3].forEach((start, index) => tone(context, {
      frequency: 260 + index * 120, end: 720 + index * 120, type: 'triangle', duration: 0.3, start, volume: 0.08,
    }));
  }
}

function playSound(kind, announce = true) {
  if (!muted) {
    if (kind === 'mjav') {
      realMeow.currentTime = 0;
      realMeow.play().catch((error) => {
        if (error.name !== 'AbortError' && !muted && !document.hidden) synthSound('mjav');
      });
    } else {
      synthSound(kind);
    }
  }
  totalSounds += 1;
  statusText.textContent = `${soundNames[kind]} · ${totalSounds} noise${totalSounds === 1 ? '' : 's'} this visit${muted ? ' (muted)' : ''}`;
  catStage.dataset.sound = kind;
  if (announce) window.dispatchEvent(new CustomEvent('cat:reaction', { detail: { kind } }));
  window.clearTimeout(stageTimer);
  stageTimer = window.setTimeout(() => delete catStage.dataset.sound, reduceMotion.matches ? 80 : 400);
}

function press(kind, element) {
  playSound(kind);
  window.clearTimeout(playingTimers.get(element));
  element.classList.add('is-playing');
  playingTimers.set(element, window.setTimeout(() => {
    element.classList.remove('is-playing');
    playingTimers.delete(element);
  }, 400));
}

function stopChaos() {
  window.clearInterval(chaosTimer);
  chaosTimer = undefined;
  chaosButton.setAttribute('aria-pressed', 'false');
  chaosButton.classList.remove('is-active');
  chaosButton.querySelector('.chaos-label').textContent = 'unleash chaos';
}

buttons.forEach((button) => button.addEventListener('click', () => press(button.dataset.sound, button)));
catButton.addEventListener('click', () => press('mjav', catButton));

muteButton.addEventListener('click', () => {
  muted = !muted;
  realMeow.muted = muted;
  if (master) master.gain.setValueAtTime(muted ? 0 : 0.65, audioContext.currentTime);
  if (muted) stopVoices();
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.querySelector('.sound-label').textContent = muted ? 'sound off' : 'sound on';
  statusText.textContent = muted ? 'shhh... the cat is on mute' : 'sound restored · unleash responsibly';
});

chaosButton.addEventListener('click', () => {
  if (chaosTimer !== undefined) {
    stopChaos();
    stopVoices();
    statusText.textContent = 'chaos contained (for now)';
    return;
  }
  chaosButton.setAttribute('aria-pressed', 'true');
  chaosButton.classList.add('is-active');
  chaosButton.querySelector('.chaos-label').textContent = 'stop chaos';
  const next = () => {
    const button = buttons[Math.floor(Math.random() * buttons.length)];
    press(button.dataset.sound, button);
  };
  next();
  chaosTimer = window.setInterval(next, 700);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    stopChaos();
    stopVoices();
    return;
  }
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const index = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].indexOf(event.key);
  if (index >= 0) {
    event.preventDefault();
    press(buttons[index].dataset.sound, buttons[index]);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopChaos();
    stopVoices();
  }
});
window.addEventListener('pagehide', () => { stopChaos(); stopVoices(); });

window.addEventListener('cat:game-sound', (event) => {
  const kind = event.detail?.kind;
  if (soundNames[kind] && !document.hidden) playSound(kind, false);
});
