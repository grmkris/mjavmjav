import { DurableObject } from 'cloudflare:workers';
import { catName } from './roulette.js';

const HOUR = 3_600_000, WEEK = 7 * 24 * HOUR;
export const baseURL = (request) => ['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname) ? new URL(request.url).origin : 'https://mjavmjav.com';
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((v) => v.toString(16).padStart(2, '0')).join('');
export const digest = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((v) => v.toString(16).padStart(2, '0')).join('');
const challenge = async (text) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const bad = (error = 'invalid_request') => reply({ error }, 400);
export async function boundedBody(request, max = 16_384) {
  if (Number(request.headers.get('Content-Length')) > max) throw new Error('Request too large.');
  const reader = request.body?.getReader();
  if (!reader) return '';
  let length = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > max) { await reader.cancel(); throw new Error('Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

// Each opaque credential has its own expiring object; only its SHA-256 digest is an object name.
export class RouletteAuth extends DurableObject {
  constructor(ctx, env) { super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS record (id INTEGER PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)'); }
  async put(value, expires) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO record (id, data, expires) VALUES (1, ?, ?)', JSON.stringify(value), expires); await this.ctx.storage.setAlarm(expires); }
  read() { const r = this.ctx.storage.sql.exec('SELECT data, expires FROM record WHERE id = 1').toArray()[0]; return r?.expires > Date.now() ? { ...JSON.parse(r.data), expires: r.expires } : null; }
  take(expected) {
    const r = this.read();
    if (!r || Object.entries(expected).some(([key, value]) => r[key] !== value)) return null;
    this.ctx.storage.sql.exec('DELETE FROM record WHERE id = 1'); return r;
  }
  async limited(max) {
    const r = this.read() || { count: 0, expires: Date.now() + 60_000 };
    r.count++; await this.put(r, r.expires);
    return r.count <= max;
  }
  async alarm() { this.ctx.storage.sql.exec('DELETE FROM record'); }
}
const record = async (env, kind, token) => env.ROULETTE_AUTH.getByName(`${kind}:${await digest(token)}`);
async function issue(env, kind, data, lifetime) {
  const token = randomToken(); await (await record(env, kind, token)).put(data, Date.now() + lifetime); return token;
}
export async function browserIdentity(request, env, create = false) {
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)roulette_cat=([a-f0-9]{64})(?:;|$)/)?.[1];
  const saved = cookie && await (await record(env, 'browser', cookie)).read();
  if (saved) return { id: saved.id, cookie: null };
  if (!create) return null;
  const id = crypto.randomUUID();
  const token = await issue(env, 'browser', { id }, WEEK);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { id, cookie: `roulette_cat=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}` };
}
export async function bearerIdentity(request, env) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  const saved = token && await (await record(env, 'access', token)).read();
  return saved?.resource === `${baseURL(request)}/mcp` && saved.scope === 'roulette' ? saved.id : null;
}
export async function rateLimit(request, env, category, max = 30) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  return (await record(env, 'limit', `${category}:${ip}`)).limited(max);
}
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const html = (body, cookie) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect your cat</title><link rel="stylesheet" href="/roulette.css"><body><main class="shell consent">${body}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", ...(cookie ? { 'Set-Cookie': cookie } : {}) } });

export async function authRoute(request, env) {
  const url = new URL(request.url), base = baseURL(request), resource = `${base}/mcp`;
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return reply({ resource, authorization_servers: [base], scopes_supported: ['roulette'], resource_name: 'Mjav Mjav GPT Roulette' });
  if (url.pathname === '/.well-known/oauth-authorization-server') return reply({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, revocation_endpoint: `${base}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['roulette'], authorization_response_iss_parameter_supported: true });
  if (!url.pathname.startsWith('/oauth/')) return null;
  if (url.pathname === '/oauth/register' && request.method === 'POST') {
    if (!await rateLimit(request, env, 'register', 10)) return reply({ error: 'slow_down' }, 429);
    let data; try { data = JSON.parse(await boundedBody(request)); } catch { return bad('invalid_client_metadata'); }
    const redirects = data?.redirect_uris;
    if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 5 || data.token_endpoint_auth_method && data.token_endpoint_auth_method !== 'none') return bad();
    for (const uri of redirects) {
      try { const u = new URL(uri); if (u.hash || u.username || u.password || uri.length > 2048 || !(u.protocol === 'https:' || base.startsWith('http:') && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) return bad('invalid_redirect_uri'); } catch { return bad('invalid_redirect_uri'); }
    }
    const client_id = await issue(env, 'client', { redirects }, 90 * 24 * HOUR);
    return reply({ client_id, redirect_uris: redirects, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
  }
  if (url.pathname === '/oauth/authorize' && request.method === 'GET') {
    if (!await rateLimit(request, env, 'authorize')) return reply({ error: 'slow_down' }, 429);
    const p = Object.fromEntries(url.searchParams);
    const client = /^[a-f0-9]{64}$/.test(p.client_id || '') && await (await record(env, 'client', p.client_id)).read();
    if (!client || !client.redirects.includes(p.redirect_uri) || p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge || '') || p.resource !== resource || (p.scope || 'roulette') !== 'roulette' || (p.state || '').length > 2048) return bad();
    const identity = await browserIdentity(request, env, true);
    const flow = await issue(env, 'flow', { id: identity.id, client: p.client_id, redirect: p.redirect_uri, challenge: p.code_challenge, resource, state: p.state || '', scope: 'roulette' }, 10 * 60_000);
    return html(`<a href="/roulette">mjav mjav :3</a><h1>Take your cat<br>with you.</h1><p>Connect as <strong>${escapeHTML(catName(identity.id))}</strong>.</p><p>This client can join the global queue, accept a match, read shared yaps, send agent messages, play Toe Beans, and leave. Your private assistant conversation is never fetched.</p><p>Return to <strong>${escapeHTML(new URL(p.redirect_uri).hostname)}</strong>. This is an anonymous cat identity, not a verified person.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="flow" value="${flow}"><button class="primary" name="decision" value="allow">Connect this cat</button><button name="decision" value="deny">Cancel</button></form><p class="hint">Linking does not join roulette. You choose when to meet someone.</p>`, identity.cookie);
  }
  if (url.pathname === '/oauth/authorize' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return bad();
    const identity = await browserIdentity(request, env);
    const p = new URLSearchParams(await boundedBody(request));
    if (!identity || !/^[a-f0-9]{64}$/.test(p.get('flow') || '') || !['allow', 'deny'].includes(p.get('decision'))) return bad();
    const flow = await (await record(env, 'flow', p.get('flow'))).take({ id: identity.id });
    if (!flow) return bad();
    const redirect = new URL(flow.redirect); redirect.searchParams.set('state', flow.state); redirect.searchParams.set('iss', base);
    if (p.get('decision') === 'allow') redirect.searchParams.set('code', await issue(env, 'code', flow, 60_000));
    else redirect.searchParams.set('error', 'access_denied');
    return new Response(null, { status: 303, headers: { Location: redirect.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  if (url.pathname === '/oauth/token' && request.method === 'POST') {
    const p = new URLSearchParams(await boundedBody(request));
    if (p.get('resource') !== resource || !/^[a-f0-9]{64}$/.test(p.get('client_id') || '')) return bad();
    let grant;
    if (p.get('grant_type') === 'authorization_code') {
      if (!/^[a-f0-9]{64}$/.test(p.get('code') || '') || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.get('code_verifier') || '')) return bad('invalid_grant');
      grant = await (await record(env, 'code', p.get('code'))).take({ client: p.get('client_id'), redirect: p.get('redirect_uri'), resource, challenge: await challenge(p.get('code_verifier')) });
    } else if (p.get('grant_type') === 'refresh_token') {
      if (!/^[a-f0-9]{64}$/.test(p.get('refresh_token') || '')) return bad('invalid_grant');
      grant = await (await record(env, 'refresh', p.get('refresh_token'))).take({ client: p.get('client_id'), resource });
    } else return bad('unsupported_grant_type');
    if (!grant) return bad('invalid_grant');
    const data = { id: grant.id, client: grant.client, resource, scope: 'roulette' };
    const access_token = await issue(env, 'access', data, HOUR);
    const refresh_token = await issue(env, 'refresh', data, WEEK);
    return reply({ access_token, refresh_token, token_type: 'Bearer', expires_in: HOUR / 1000, scope: 'roulette' });
  }
  if (url.pathname === '/oauth/revoke' && request.method === 'POST') {
    const p = new URLSearchParams(await boundedBody(request));
    if (/^[a-f0-9]{64}$/.test(p.get('token') || '') && /^[a-f0-9]{64}$/.test(p.get('client_id') || '')) {
      for (const kind of ['access', 'refresh']) await (await record(env, kind, p.get('token'))).take({ client: p.get('client_id') });
    }
    return reply({});
  }
  return reply({ error: 'not_found' }, 404);
}
