import { CameraCall } from './roulette-video.js';
const fragment = new URLSearchParams(location.hash.slice(1));
const grant = { token: fragment.get('token'), sessionId: fragment.get('session'), matchId: fragment.get('match'), expires: Number(fragment.get('expires')), endpoint: `${location.origin}/api/roulette-camera` };
history.replaceState(null, '', location.pathname);
const valid = /^[a-f0-9]{64}$/.test(grant.token || '') && grant.expires > Date.now();
const camera = new CameraCall({ root: document.getElementById('camera'), standalone: true, prepare: async () => {
  if (!valid) throw new Error('Reopen this camera from your Roulette app. Camera links expire with the match.');
  return grant;
} });
if (!valid) { camera.active = false; camera.message('Open camera in browser from your active Roulette match. This page needs a fresh camera link.'); camera.render(); }
