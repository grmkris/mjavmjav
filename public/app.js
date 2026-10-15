const buttons = [...document.querySelectorAll('[data-sound]')];
const catButton = document.querySelector('#cat-button');
const catStage = document.querySelector('#cat-stage');
const muteButton = document.querySelector('#mute-button');
const chaosButton = document.querySelector('#chaos-button');
const statusText = document.querySelector('#status-text');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let audioContext;
let muted = false;
let chaosTimer;
let totalSounds = 0;
const realMeow = new Audio('/meow.wav');
realMeow.preload = 'auto';
const soundNames = { mjav: 'mjav', prrr: 'prrrrt', blep: 'blep', yap: 'YAP YAP' };

function getAudio() {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function tone(context, { frequency, type = 'sine', duration = 0.22, start = 0, end = frequency, volume = 0.12 }) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, end), context.currentTime + start + duration);
  gain.gain.setValueAtTime(0.001, context.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(context.currentTime + start);
  oscillator.stop(context.currentTime + start + duration + 0.02);
}

function playSound(kind) {
  if (!muted) {
    if (kind === 'mjav') {
      realMeow.currentTime = 0;
      realMeow.play().catch(() => {});
    }
    const context = getAudio();
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
  }
  totalSounds += 1;
  statusText.textContent = `${soundNames[kind]} deployed · ${totalSounds} noise${totalSounds === 1 ? '' : 's'} today`;
  catStage.dataset.sound = kind;
  window.setTimeout(() => { if (catStage.dataset.sound === kind) delete catStage.dataset.sound; }, reduceMotion.matches ? 80 : 560);
}

function press(kind, element) {
  playSound(kind);
  element.classList.remove('is-playing');
  void element.offsetWidth;
  element.classList.add('is-playing');
  window.setTimeout(() => element.classList.remove('is-playing'), 400);
}

buttons.forEach((button) => button.addEventListener('click', () => press(button.dataset.sound, button)));
catButton.addEventListener('click', () => press('mjav', catButton));

muteButton.addEventListener('click', () => {
  muted = !muted;
  muteButton.setAttribute('aria-pressed', String(muted));
  muteButton.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  muteButton.textContent = muted ? '◖×)' : '◖)))';
  statusText.textContent = muted ? 'shhh... the cat is on mute' : 'sound restored · unleash responsibly';
});

chaosButton.addEventListener('click', () => {
  const active = chaosButton.getAttribute('aria-pressed') === 'true';
  chaosButton.setAttribute('aria-pressed', String(!active));
  chaosButton.classList.toggle('is-active', !active);
  if (active) {
    window.clearInterval(chaosTimer);
    statusText.textContent = 'chaos contained (for now)';
    return;
  }
  statusText.textContent = 'CHAOS MODE · the cat has escaped';
  chaosTimer = window.setInterval(() => {
    const button = buttons[Math.floor(Math.random() * buttons.length)];
    press(button.dataset.sound, button);
  }, reduceMotion.matches ? 1100 : 680);
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('button, input, textarea, select, a')) return;
  const index = Number(event.key) - 1;
  if (index >= 0 && index < buttons.length) press(buttons[index].dataset.sound, buttons[index]);
});
