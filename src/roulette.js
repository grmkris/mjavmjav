import { DurableObject } from 'cloudflare:workers';
import { CatError, demand, WAIT_MS, MATCH_MS, newMatch, matchView, actOnMatch } from './roulette-core.js';

const names = ['Soup Goblin', 'Cosmic Loaf', 'Soggy Biscuit', 'Turbo Bean', 'Moon Potato', 'Noodle Gremlin'];
export const catName = (id) => `${names[parseInt(id.slice(0, 2), 16) % names.length]} ${id.slice(-4)}`;

// This singleton only coordinates the bounded global queue; every chat/game has its own object.
export class RouletteQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS cats (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  }
  rows() { return this.ctx.storage.sql.exec('SELECT data FROM cats').toArray().map((r) => JSON.parse(r.data)); }
  save(cat) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO cats VALUES (?, ?)', cat.id, JSON.stringify(cat)); }
  sweep() { for (const cat of this.rows()) if (cat.expires <= Date.now()) this.ctx.storage.sql.exec('DELETE FROM cats WHERE id = ?', cat.id); }
  async join(id) {
    this.sweep();
    const result = this.ctx.storage.transactionSync(() => {
      const rows = this.rows();
      let cat = rows.find((r) => r.id === id);
      if (cat?.match || cat?.waiting) return cat;
      demand(rows.length < 256 || cat, 'The cat queue is full. Try again shortly.');
      const now = Date.now();
      cat ||= { id, name: catName(id), avoid: [] };
      const peer = rows.filter((r) => r.waiting && r.id !== id && !cat.avoid.includes(r.id) && !r.avoid.includes(id)).sort((a,b) => a.waiting - b.waiting)[0];
      cat.waiting = now; cat.expires = now + WAIT_MS;
      if (peer) {
        const match = { id: crypto.randomUUID(), members: [peer, cat].map(({ id, name }) => ({ id, name })), created: now };
        for (const member of [peer, cat]) { member.match = match; member.waiting = 0; member.expires = now + MATCH_MS; this.save(member); }
      } else this.save(cat);
      return cat;
    });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return result;
  }
  read(id) { this.sweep(); return this.rows().find((r) => r.id === id) || null; }
  leave(id, matchId) {
    const cat = this.read(id);
    if (!cat || (matchId && cat.match?.id !== matchId)) return;
    if (cat.match) cat.avoid = [...cat.avoid, ...cat.match.members.filter((m) => m.id !== id).map((m) => m.id)].slice(-32);
    cat.match = null; cat.waiting = 0; cat.expires = Date.now() + MATCH_MS; this.save(cat);
  }
  async alarm() { this.sweep(); if (this.rows().length) await this.ctx.storage.setAlarm(Date.now() + 60_000); }
}

export class RouletteMatch extends DurableObject {
  constructor(ctx, env) { super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS match (id INTEGER PRIMARY KEY, data TEXT NOT NULL)'); }
  current() { const row = this.ctx.storage.sql.exec('SELECT data FROM match WHERE id = 1').toArray()[0]; return row ? JSON.parse(row.data) : null; }
  async setup(info) {
    if (!this.current()) {
      this.ctx.storage.sql.exec('INSERT INTO match (id, data) VALUES (1, ?)', JSON.stringify(newMatch(info.id, info.members, info.created)));
      await this.ctx.storage.setAlarm(info.created + MATCH_MS);
    }
  }
  read(id) {
    const match = this.current();
    demand(match, 'This connection expired. Find another cat.');
    const phase = match.phase;
    const view = matchView(match, id, Date.now());
    if (phase !== match.phase) this.ctx.storage.sql.exec('UPDATE match SET data = ? WHERE id = 1', JSON.stringify(match));
    return view;
  }
  act(id, action, args, channel) {
    const match = this.current();
    demand(match, 'This connection expired. Find another cat.');
    actOnMatch(match, id, action, args, Date.now(), channel);
    this.ctx.storage.sql.exec('UPDATE match SET data = ? WHERE id = 1', JSON.stringify(match));
    return matchView(match, id, Date.now());
  }
  async alarm() { this.ctx.storage.sql.exec('DELETE FROM match'); }
}

export async function roulette(env, id, action, args = {}, channel = 'agent') {
  const queue = env.ROULETTE_QUEUE.getByName('global');
  const cat = action === 'join' ? await queue.join(id) : await queue.read(id);
  let match = null;
  if (cat?.match) {
    const room = env.ROULETTE_MATCHES.getByName(cat.match.id);
    await room.setup(cat.match);
    if (['status', 'join'].includes(action)) match = await room.read(id);
    else {
      demand(args.matchId === cat.match.id, 'Refresh: that connection is no longer current.');
      match = await room.act(id, action, args, channel);
    }
  } else if (!['status', 'join', 'leave'].includes(action)) throw new CatError('Find another cat first.');
  if (action === 'leave') { await queue.leave(id, cat?.match?.id); match = null; }
  return { me: { id, name: catName(id) }, status: match?.phase || (action !== 'leave' && cat?.waiting ? 'waiting' : 'idle'),
    queueExpires: cat?.waiting ? cat.expires : null, match };
}
