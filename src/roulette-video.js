import { baseURL, boundedBody, browserIdentity, digest, randomToken, reply } from './roulette-auth.js';
import { demand } from './roulette-core.js';
import { validSession } from './roulette-video-core.js';

const credential = async (env, token) => env.ROULETTE_AUTH.getByName(`camera:${await digest(token)}`);
const roomFor = (env, matchId) => env.ROULETTE_MATCHES.getByName(matchId);

export async function cameraSession(env, participant, matchId, sessionId, base) {
  demand(validSession(matchId) && validSession(sessionId), 'Invalid camera connection.');
  const cat = await env.ROULETTE_QUEUE.getByName('global').read(participant);
  demand(cat?.match?.id === matchId, 'Refresh: that cat connection is no longer current.');
  const room = roomFor(env, matchId);
  const match = await room.read(participant);
  demand(match.phase === 'active', 'Both people must shake paws first.');
  const limit = env.ROULETTE_AUTH.getByName(`camera-limit:${participant}`);
  demand(await limit.limited(6), 'Too many camera starts. Try again in a minute.');
  const expires = Math.min(match.expires, Date.now() + 30 * 60_000);
  let iceServers = [], relay = true;
  if (env.TURN_KEY_ID && env.TURN_KEY_TOKEN) {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: Math.max(60, Math.ceil((expires - Date.now()) / 1000)) }), signal: AbortSignal.timeout(8000),
    });
    demand(response.ok, 'The camera relay is unavailable. Try again shortly.');
    iceServers = (await response.json()).iceServers;
    demand(Array.isArray(iceServers) && iceServers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u))), 'The camera relay is unavailable.');
  } else {
    demand(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'The camera relay is not configured yet.');
    relay = false; // Local browser fixtures only. Production never falls back to direct IP exposure.
  }
  // Recheck authority after the provider request; either person may have left during it.
  demand((await room.read(participant)).phase === 'active', 'This cat connection ended.');
  const token = randomToken();
  const data = { participant, matchId, sessionId, iceServers, relay, expires };
  await (await credential(env, token)).put(data, expires);
  return { token, endpoint: `${base}/api/roulette-camera`, sessionId, matchId, expires };
}

export async function cameraRoute(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/roulette-camera')) return null;
  const origin = request.headers.get('Origin');
  // These endpoints accept an explicit, scoped bearer capability, never cross-origin cookies.
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Referrer-Policy': 'no-referrer' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405, headers);
  try {
    const args = JSON.parse(await boundedBody(request, 32_768));
    if (url.pathname === '/api/roulette-camera/session') {
      demand(origin === url.origin, 'Open Roulette on this website.');
      const identity = await browserIdentity(request, env);
      demand(identity, 'Open Roulette and connect first.');
      return reply(await cameraSession(env, identity.id, args.matchId, args.sessionId, baseURL(request)));
    }
    demand(url.pathname === '/api/roulette-camera', 'Unknown camera endpoint.');
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return reply({ error: 'Camera access expired. Reopen it from Roulette.' }, 401, headers);
    const grant = await (await credential(env, token)).read();
    if (!grant) return reply({ error: 'Camera access expired. Reopen it from Roulette.' }, 401, headers);
    const room = roomFor(env, grant.matchId);
    if (args.action === 'config') {
      demand((await room.read(grant.participant)).phase === 'active', 'This cat connection ended.');
      // No new provider call: credentials belong to this bounded match capability.
      return reply({ iceServers: grant.iceServers, iceTransportPolicy: grant.relay ? 'relay' : 'all', expires: grant.expires }, 200, headers);
    }
    const result = await room.camera(grant.participant, grant.sessionId, args.action, args);
    return reply(result, 200, headers);
  } catch (error) { return reply({ error: error.message?.slice(0, 200) || 'Camera connection failed.' }, 400, headers); }
}
