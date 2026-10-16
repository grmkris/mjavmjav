import { DurableObject } from 'cloudflare:workers';
import { createGame, applyInput, applyPlan, publicGame, stepGame, MODES, COLORS, ROOM_SOUNDS } from '../public/game-core.js';
import { authRoute, browserIdentity, boundedBody, rateLimit, reply } from './roulette-auth.js';
import { roulette } from './roulette.js';
import { serveMcp } from './roulette-mcp.js';
import { cameraRoute } from './roulette-video.js';
export { RouletteAuth } from './roulette-auth.js';
export { RouletteQueue, RouletteMatch } from './roulette.js';

const GLOBAL_ROOM = 'global';
const MAX_CONNECTIONS = 256;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export class CatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL, snapshot TEXT)');
    this.room = ctx.storage.sql.exec('SELECT * FROM room WHERE id = 1').toArray()[0] || null;
    if (!this.room) {
      // This object is intentionally permanent: mjavmjav.com has one noisy lobby.
      const expires = 0; // No expiry for the global lobby; legacy rooms keep theirs.
      ctx.storage.sql.exec('INSERT INTO room (id, code, expires, snapshot) VALUES (1, ?, ?, NULL)', GLOBAL_ROOM, expires);
      this.room = { id: 1, code: GLOBAL_ROOM, expires, snapshot: null };
    }
    this.world = this.room?.snapshot ? JSON.parse(this.room.snapshot) : null;
    if (![2, 3].includes(this.world?.version)) this.world = null;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS stage (id INTEGER PRIMARY KEY, events TEXT NOT NULL)');
    this.soundStage = JSON.parse(ctx.storage.sql.exec('SELECT events FROM stage WHERE id = 1').toArray()[0]?.events || '[]');
    this.timer = undefined;
    this.nextRoundTimer = undefined;
    this.frame = 0;
    this.lastTick = Date.now();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    if (this.world && this.world.phase !== 'over' && ctx.getWebSockets().length) this.startTimer();
    else if (this.world?.phase !== 'over') this.world = null;
    this.scheduleRound();
  }

  sockets() { return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1); }
  roster() {
    return this.sockets().map((socket) => socket.deserializeAttachment()).filter(Boolean).sort((a, b) => a.joined - b.joined || a.id.localeCompare(b.id));
  }
  queue() { return this.roster().filter((player) => player.queued).sort((a, b) => a.queued - b.queued); }
  checkpoint() {
    this.ctx.storage.sql.exec('UPDATE room SET snapshot = ? WHERE id = 1', this.world ? JSON.stringify(this.world) : null);
  }
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const socket of this.sockets()) {
      try { socket.send(data); } catch { socket.close(1011, 'Cat connection lost'); }
    }
  }
  state() {
    const players = this.roster().map(({ id, name, color }) => ({ id, name, color }));
    const queue = this.queue();
    const waitingMode = (!this.world || this.world.phase === 'over') && queue.find((cat) => cat.auto)?.mode === 'bonk' && queue.length < 2 ? 'bonk' : null;
    return { type: 'state', lobby: GLOBAL_ROOM, players, queue: queue.map((player) => player.id), world: publicGame(this.world), waitingMode };
  }
  sync() { this.broadcast(this.state()); }

  startRound(mode, countdown = 5) {
    const racers = this.queue().slice(0, 8);
    if (!racers.length || (this.world && this.world.phase !== 'over')) return;
    if (mode === 'bonk' && racers.length < 2) { this.sync(); return; }
    clearTimeout(this.nextRoundTimer); this.nextRoundTimer = undefined;
    for (const socket of this.sockets()) {
      const cat = socket.deserializeAttachment();
      if (racers.some((racer) => racer.id === cat.id)) { cat.queued = 0; socket.serializeAttachment(cat); }
    }
    this.world = createGame(mode, racers.map(({ id, name }, index) => ({ id, name, color: COLORS[index] })), crypto.getRandomValues(new Uint32Array(1))[0], countdown);
    this.checkpoint(); this.sync(); this.startTimer();
  }
  scheduleRound() {
    if (this.nextRoundTimer !== undefined || (this.world && this.world.phase !== 'over') || !this.queue().some((cat) => cat.auto)) return;
    if (this.queue().find((cat) => cat.auto)?.mode === 'bonk' && this.queue().length < 2) { this.sync(); return; }
    this.nextRoundTimer = setTimeout(() => {
      this.nextRoundTimer = undefined;
      const next = this.queue().find((cat) => cat.auto);
      if (next) this.startRound(next.mode || 'flappy');
    }, 4000);
  }

  async fetch(request) {
    if (!this.room || (this.room.code !== GLOBAL_ROOM && this.room.expires < Date.now())) return json({ error: 'The global cat lobby is taking a nap.' }, 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426);
    const roster = this.roster();
    if (roster.length >= MAX_CONNECTIONS) return json({ error: 'The lobby is full of brain cells. Try again in a moment.' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const adjectives = ['Soup', 'Cosmic', 'Noodle', 'Soggy', 'Turbo', 'Tiny', 'Moon', 'Toasty'];
    const nouns = ['Goblin', 'Bean', 'Gremlin', 'Loaf', 'Yapper', 'Biscuit', 'Moth', 'Potato'];
    const color = COLORS[roster.length % COLORS.length];
    const bytes = crypto.getRandomValues(new Uint8Array(2));
    const baseNames = adjectives.flatMap((adjective) => nouns.map((noun) => `${adjective} ${noun}`));
    const base = baseNames[bytes[0] % baseNames.length];
    let name = base;
    let suffix = 2;
    while (roster.some((player) => player.name === name)) name = `${base} ${suffix++}`;
    const joined = Math.max(Date.now(), ...roster.map((player) => player.joined + 1));
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name, color, joined, queued: 0, window: Date.now(), messages: 0, reaction: 0 });
    server.send(JSON.stringify({ type: 'welcome', id, sounds: this.soundStage }));
    this.sync();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, data) {
    if (typeof data !== 'string' || data.length > 512) return socket.close(1008, 'Too much cat');
    let message;
    try { message = JSON.parse(data); } catch { return socket.close(1008, 'Invalid cat language'); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const player = socket.deserializeAttachment();
    const now = Date.now();
    if (now - player.window >= 1000) { player.window = now; player.messages = 0; }
    if (++player.messages > 45) return socket.close(1008, 'Slow those paws');
    socket.serializeAttachment(player);
    if (message.type === 'play' && MODES.includes(message.mode)) {
      if (this.world?.phase !== 'over' && this.world?.players.some((cat) => cat.id === player.id && cat.alive)) return;
      player.queued ||= Math.max(now, ...this.queue().map((cat) => cat.queued + 1));
      player.auto = true; player.mode = message.mode;
      socket.serializeAttachment(player);
      if (!this.world || this.world.phase === 'over') this.startRound(this.queue().find((cat) => cat.auto)?.mode || message.mode);
      else if (this.world.phase === 'countdown' && this.world.countdown > 0.5 && this.world.players.length < 8) {
        // A friend can join the current countdown in one tap. FIFO still applies.
        for (const entrant of this.queue().filter((cat) => !this.world.players.some((racer) => racer.id === cat.id)).slice(0, 8 - this.world.players.length)) {
          const avatar = createGame(this.world.mode, [...this.world.players, { id: entrant.id, name: entrant.name, color: COLORS[this.world.players.length] }], 1).players.at(-1);
          this.world.players.push(avatar);
          const connection = this.sockets().find((candidate) => candidate.deserializeAttachment()?.id === entrant.id);
          entrant.queued = 0; connection?.serializeAttachment(entrant);
        }
        this.checkpoint(); this.sync();
      } else this.sync();
    } else if (message.type === 'queue' && typeof message.join === 'boolean') {
      // Opt in each round; spectators and solo players are never drafted.
      if (message.join === Boolean(player.queued)) return;
      player.queued = message.join ? Math.max(now, ...this.queue().map((cat) => cat.queued + 1)) : 0;
      player.auto = false;
      socket.serializeAttachment(player);
      this.sync();
    } else if (message.type === 'start') {
      if (!player.queued || !MODES.includes(message.mode) || (this.world && this.world.phase !== 'over')) return;
      this.startRound(message.mode, 3);
    } else if (message.type === 'retire') {
      const avatar = this.world?.players.find((cat) => cat.id === player.id);
      if (avatar) avatar.alive = false;
    } else if (message.type === 'plan') {
      const accepted = applyPlan(this.world, player.id, message);
      if (accepted) this.checkpoint();
      socket.send(JSON.stringify({ type: 'plan-ack', round: message.round, turn: message.turn, accepted }));
      if (accepted) this.sync();
    } else if (message.type === 'input') {
      if (typeof message.flap !== 'boolean' && ![-1, 0, 1].includes(message.direction)) return;
      applyInput(this.world, player.id, { flap: message.flap === true, direction: message.direction });
    } else if (message.type === 'reaction' && ROOM_SOUNDS.includes(message.sound)) {
      if (now - player.reaction < 700 || now - (this.soundStage.at(-1)?.at || 0) < 250) {
        socket.send(JSON.stringify({ type: 'notice', text: 'Tiny breath. The global microphone needs a quarter-second nap.' }));
        return;
      }
      player.reaction = now;
      socket.serializeAttachment(player);
      const reaction = { type: 'reaction', key: crypto.randomUUID(), id: player.id, name: player.name, sound: message.sound, at: now };
      const sounds = [...this.soundStage, reaction].slice(-12);
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO stage (id, events) VALUES (1, ?)', JSON.stringify(sounds));
      this.soundStage = sounds;
      this.broadcast(reaction);
    }
  }

  startTimer() {
    if (this.timer !== undefined) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!this.world || !this.sockets().length || (this.room.code !== GLOBAL_ROOM && now >= this.room.expires)) {
        this.stopTimer();
        this.world = null;
        this.checkpoint();
        return;
      }
      const elapsed = Math.min((now - this.lastTick) / 1000, 0.25);
      this.lastTick = now;
      const previousTurn = this.world.turn;
      const previousTurnPhase = this.world.turnPhase;
      const steps = Math.max(1, Math.round(elapsed * 60));
      for (let i = 0; i < steps; i++) stepGame(this.world, elapsed / steps);
      this.frame += 1;
      // Roster changes have their own messages; do not resend 256 names per tick.
      const transitioned = previousTurn !== this.world.turn || previousTurnPhase !== this.world.turnPhase;
      if (this.frame % 20 === 0 || this.world.phase === 'over' || transitioned) this.checkpoint();
      // Turn-based play needs countdown updates, not ten full maps per second.
      if (this.frame % (this.world.mode === 'bonk' ? 10 : 2) === 0 || transitioned || this.world.phase === 'over') this.broadcast({ type: 'frame', world: publicGame(this.world) });
      if (this.world.phase === 'over') { this.stopTimer(); this.scheduleRound(); }
    }, 50);
  }
  stopTimer() { clearInterval(this.timer); this.timer = undefined; }
  webSocketClose(socket) {
    // Complete the close handshake in local runtimes as well as on Cloudflare.
    socket.close(1000, 'Cat left');
    if (!this.room) return;
    const player = socket.deserializeAttachment();
    const avatar = this.world?.players.find((item) => item.id === player?.id);
    if (avatar) avatar.alive = false;
    if (!this.sockets().length) { clearTimeout(this.nextRoundTimer); this.nextRoundTimer = undefined; this.stopTimer(); this.world = null; this.checkpoint(); }
    else this.sync();
  }
  webSocketError(socket) { socket.close(1011, 'Cat connection lost'); this.webSocketClose(socket); }
  async alarm() {
    if (this.room?.code === GLOBAL_ROOM) return;
    this.stopTimer();
    for (const socket of this.sockets()) socket.close(1000, 'The room has gone for a nap');
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.world = null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/roulette-camera')) return cameraRoute(request, env);
    if (url.pathname === '/mcp') return serveMcp(request, env);
    if (url.pathname.startsWith('/oauth/') || url.pathname.startsWith('/.well-known/')) {
      try { return await authRoute(request, env) || reply({ error: 'not_found' }, 404); }
      catch { return reply({ error: 'invalid_request' }, 400); }
    }
    if (url.pathname === '/api/roulette' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return reply({ error: 'Join from this website.' }, 403);
      try {
        const { action, ...args } = JSON.parse(await boundedBody(request));
        if (!['status', 'join', 'accept', 'leave', 'say', 'game', 'move'].includes(action)) return reply({ error: 'Unknown cat action.' }, 400);
        let identity = await browserIdentity(request, env);
        if (!identity) {
          if (!await rateLimit(request, env, 'browser')) return reply({ error: 'Too many cats. Try again shortly.' }, 429);
          identity = await browserIdentity(request, env, true);
        }
        const state = await roulette(env, identity.id, action, args, 'app');
        return reply(state, 200, identity.cookie ? { 'Set-Cookie': identity.cookie } : {});
      } catch (error) { return reply({ error: error.message?.slice(0, 240) || 'The cat connection failed.' }, 400); }
    }
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'Join from this website.' }, 403);
    if (url.pathname === '/api/room' && request.method === 'GET') return env.CAT_ROOMS.getByName(GLOBAL_ROOM).fetch(request);
    return json({ error: 'No cats at this address.' }, 404);
  },
};
