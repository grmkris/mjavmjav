import { DurableObject } from 'cloudflare:workers';
import { createGame, applyInput, stepGame, MODES, COLORS, ROOM_SOUNDS } from '../public/game-core.js';

const CODE = /^[a-z0-9]{8}$/;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export class CatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL, snapshot TEXT)');
    this.room = ctx.storage.sql.exec('SELECT * FROM room WHERE id = 1').toArray()[0] || null;
    this.world = this.room?.snapshot ? JSON.parse(this.room.snapshot) : null;
    this.timer = undefined;
    this.frame = 0;
    this.lastTick = Date.now();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    if (this.world && this.world.phase !== 'over' && ctx.getWebSockets().length) this.startTimer();
    else if (this.world?.phase !== 'over') this.world = null;
  }

  async create(code) {
    if (this.room) return false;
    const expires = Date.now() + 60 * 60 * 1000;
    this.ctx.storage.sql.exec('INSERT INTO room (id, code, expires) VALUES (1, ?, ?)', code, expires);
    this.room = { code, expires };
    await this.ctx.storage.setAlarm(expires);
    return true;
  }

  sockets() { return this.ctx.getWebSockets().filter((socket) => socket.readyState === 1); }
  roster() {
    return this.sockets().map((socket) => socket.deserializeAttachment()).filter(Boolean).sort((a, b) => a.joined - b.joined || a.id.localeCompare(b.id));
  }
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
    return { type: 'state', code: this.room.code, hostId: players[0]?.id, players, world: this.world };
  }
  sync() { this.broadcast(this.state()); }

  async fetch(request) {
    if (!this.room || this.room.expires < Date.now()) return json({ error: 'That room has gone for a nap. Make a new one.' }, 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426);
    const roster = this.roster();
    if (roster.length >= 8) return json({ error: 'All eight brain cells are occupied. Try another room.' }, 409);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    const adjectives = ['Soup', 'Cosmic', 'Noodle', 'Soggy', 'Turbo', 'Tiny', 'Moon', 'Toasty'];
    const nouns = ['Goblin', 'Bean', 'Gremlin', 'Loaf', 'Yapper', 'Biscuit', 'Moth', 'Potato'];
    const unused = COLORS.filter((color) => !roster.some((player) => player.color === color));
    const bytes = crypto.getRandomValues(new Uint8Array(2));
    const names = adjectives.flatMap((adjective) => nouns.map((noun) => `${adjective} ${noun}`)).filter((name) => !roster.some((player) => player.name === name));
    const joined = Math.max(Date.now(), ...roster.map((player) => player.joined + 1));
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name: names[bytes[0] % names.length], color: unused[0], joined, window: Date.now(), messages: 0, reaction: 0 });
    server.send(JSON.stringify({ type: 'welcome', id }));
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
    if (message.type === 'start') {
      if (this.roster()[0]?.id !== player.id || !MODES.includes(message.mode) || (this.world && this.world.phase !== 'over')) return;
      this.world = createGame(message.mode, this.roster().map(({ id, name, color }) => ({ id, name, color })), crypto.getRandomValues(new Uint32Array(1))[0], 3);
      this.checkpoint();
      this.sync();
      this.startTimer();
    } else if (message.type === 'input') {
      if (typeof message.flap !== 'boolean' && ![-1, 0, 1].includes(message.direction)) return;
      applyInput(this.world, player.id, { flap: message.flap === true, direction: message.direction });
    } else if (message.type === 'reaction' && ROOM_SOUNDS.includes(message.sound) && now - player.reaction >= 600) {
      player.reaction = now;
      socket.serializeAttachment(player);
      this.broadcast({ type: 'reaction', id: player.id, name: player.name, sound: message.sound });
    }
  }

  startTimer() {
    if (this.timer !== undefined) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      if (!this.world || !this.sockets().length || now >= this.room.expires) {
        this.stopTimer();
        this.world = null;
        this.checkpoint();
        return;
      }
      const elapsed = Math.min((now - this.lastTick) / 1000, 0.25);
      this.lastTick = now;
      const steps = Math.max(1, Math.round(elapsed * 60));
      for (let i = 0; i < steps; i++) stepGame(this.world, elapsed / steps);
      this.frame += 1;
      if (this.frame % 2 === 0 || this.world.phase === 'over') this.sync();
      if (this.frame % 20 === 0 || this.world.phase === 'over') this.checkpoint();
      if (this.world.phase === 'over') this.stopTimer();
    }, 50);
  }
  stopTimer() { clearInterval(this.timer); this.timer = undefined; }
  webSocketClose(socket) {
    if (!this.room) return;
    const player = socket.deserializeAttachment();
    const avatar = this.world?.players.find((item) => item.id === player?.id);
    if (avatar) avatar.alive = false;
    if (!this.sockets().length) { this.stopTimer(); this.world = null; this.checkpoint(); }
    else this.sync();
  }
  webSocketError(socket) { socket.close(1011, 'Cat connection lost'); this.webSocketClose(socket); }
  async alarm() {
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
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'Join from this website.' }, 403);
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const code = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
      if (!(await env.CAT_ROOMS.getByName(code).create(code))) return json({ error: 'Try creating a room again.' }, 409);
      return json({ code }, 201);
    }
    const match = url.pathname.match(/^\/api\/rooms\/([a-z0-9]{8})$/);
    if (match && CODE.test(match[1]) && request.method === 'GET') return env.CAT_ROOMS.getByName(match[1]).fetch(request);
    return json({ error: 'No cats at this address.' }, 404);
  },
};
