import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, expect, request as requests } from '@playwright/test';
import { rpc, call, register, authorize, tokenForm, connect, operationId } from './roulette-helpers.js';
const localOnly = () => test.skip(Boolean(process.env.SITE_URL), 'Pairing and OAuth mutations stay local; never match production strangers.');

test('MCP discovery, resource and transport expose the portable app without joining', async ({ request, baseURL }) => {
  const init = await rpc(request, baseURL, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  expect(init.status()).toBe(200); expect((await init.json()).result.serverInfo.name).toBe('mjavmjav-gpt-roulette');
  const listed = await (await rpc(request, baseURL, 'tools/list')).json();
  expect(listed.result.tools).toHaveLength(10);
  expect(listed.result.tools.find((t) => t.name === 'roulette_open')._meta.ui.resourceUri).toBe('ui://mjavmjav/roulette-v2.html');
  expect(listed.result.tools.find((t) => t.name === 'roulette_yap')._meta.ui.visibility).toEqual(['app']);
  expect(listed.result.tools.find((t) => t.name === 'roulette_camera')._meta.ui.visibility).toEqual(['app']);
  const resource = await (await rpc(request, baseURL, 'resources/read', { uri: 'ui://mjavmjav/roulette-v2.html' })).json();
  expect(resource.result.contents[0]._meta.ui.permissions).toEqual({ camera: {}, microphone: {} });
  expect(resource.result.contents[0].mimeType).toBe('text/html;profile=mcp-app');
  expect(resource.result.contents[0].text).toContain('ui/initialize');
  expect(resource.result.contents[0].text).not.toContain('src="/roulette.js"');
  const unauthorized = await rpc(request, baseURL, 'tools/call', { name: 'roulette_join', arguments: {} });
  expect(unauthorized.status()).toBe(401); expect(unauthorized.headers()['www-authenticate']).toContain('oauth-protected-resource/mcp');
  expect((await request.get(`${baseURL}/.well-known/oauth-protected-resource/mcp`)).status()).toBe(200);
  expect((await request.get(`${baseURL}/.well-known/openid-configuration`)).status()).toBe(404);
  expect((await request.post(`${baseURL}/mcp`, { headers: { Origin: 'https://evil.invalid' }, data: {} })).status()).toBe(403);
});

test('OAuth binds code to PKCE, client, resource and browser; rotates refresh and rejects replay', async ({ request, baseURL }) => {
  localOnly();
  const client = await register(request, baseURL), grant = await authorize(request, baseURL, client), form = tokenForm(baseURL, grant);
  expect((await request.post('/oauth/token', { form: { ...form, code_verifier: 'x'.repeat(64) } })).status()).toBe(400);
  expect((await request.post('/oauth/token', { form: { ...form, resource: 'https://wrong.invalid/mcp' } })).status()).toBe(400);
  const token = await request.post('/oauth/token', { form }); expect(token.status()).toBe(200); const auth = await token.json();
  expect((await request.post('/oauth/token', { form })).status()).toBe(400);
  const sdk = new Client({ name: 'roulette-acceptance', version: '1' });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${auth.access_token}` } } }));
  expect((await sdk.listTools()).tools).toHaveLength(10);
  expect((await sdk.callTool({ name: 'roulette_open', arguments: {} })).structuredContent.status).toBe('idle');
  await sdk.close();
  const a = await call(request, baseURL, auth.access_token, 'roulette_status');
  const browser = await (await request.post('/api/roulette', { headers: { Origin: baseURL }, data: { action: 'status' } })).json();
  expect(a.structuredContent.me.id).toBe(browser.me.id);
  const refresh = { grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: client, resource: `${baseURL}/mcp` };
  const refreshed = await request.post('/oauth/token', { form: refresh }); expect(refreshed.status()).toBe(200);
  expect((await request.post('/oauth/token', { form: refresh })).status()).toBe(400);
  await request.post('/oauth/revoke', { form: { token: auth.access_token, client_id: client } });
  expect((await rpc(request, baseURL, 'tools/call', { name: 'roulette_status', arguments: {} }, auth.access_token)).status()).toBe(401);
  const denied = await request.post('/api/roulette', { headers: { Origin: 'https://evil.invalid' }, data: { action: 'join' } }); expect(denied.status()).toBe(403);
});

test('two authenticated MCP pairs handshake, chat, play and stay isolated', async ({ request, baseURL }) => {
  localOnly();
  const client = await register(request, baseURL), contexts = [];
  const users = [];
  try {
    for (let i = 0; i < 4; i++) { const ctx = await requests.newContext({ baseURL }); contexts.push(ctx); users.push(await connect(ctx, baseURL, client)); }
    const tool = (i, name, args) => call(contexts[i], baseURL, users[i].access_token, `roulette_${name}`, args);
    for (let i = 0; i < 4; i++) await tool(i, 'join');
    const states = await Promise.all(users.map((_, i) => tool(i, 'status').then((r) => r.structuredContent)));
    const first = states[0].match.id, second = states[2].match.id; expect(first).not.toBe(second);
    expect(states[1].match.id).toBe(first); expect(states[3].match.id).toBe(second);
    expect((await tool(0, 'say', { matchId: first, text: 'too early', operationId: operationId() })).isError).toBe(true);
    await tool(0, 'accept', { matchId: first, operationId: operationId() });
    expect((await tool(0, 'status')).structuredContent.status).toBe('handshake');
    await tool(1, 'accept', { matchId: first, operationId: operationId() });
    const send = { matchId: first, text: '<script>private cat yap</script>', operationId: operationId() };
    await tool(0, 'say', send); await tool(0, 'say', send);
    expect((await tool(1, 'status')).structuredContent.match.messages).toHaveLength(1);
    expect((await tool(2, 'status')).structuredContent.match.messages).toEqual([]);
    expect((await tool(2, 'accept', { matchId: first, operationId: operationId() })).isError).toBe(true);
    const started = await tool(0, 'game', { matchId: first, operationId: operationId() });
    const gameId = started.structuredContent.match.game.id;
    for (const [i, cell] of [[0,0],[1,3],[0,1],[1,4],[0,2]]) {
      const result = await tool(i, 'move', { matchId: first, gameId, cell, operationId: operationId() }); expect(result.isError).toBeUndefined();
    }
    expect((await tool(1, 'status')).structuredContent.match.game.winner).toBe(states[0].me.id);
    expect((await tool(0, 'move', { matchId: first, gameId, cell: 11, operationId: operationId() })).isError).toBe(true);
    await tool(0, 'leave', { matchId: first, operationId: operationId() });
    const closed = (await tool(1, 'status')).structuredContent; expect(closed.status).toBe('closed'); expect(closed.match.messages).toEqual([]);
    await tool(1, 'leave', { matchId: first, operationId: operationId() });
    for (const i of [0,1]) expect((await tool(i, 'join')).structuredContent.status).toBe('waiting');
    for (let i = 0; i < 4; i++) await tool(i, 'leave', { matchId: i > 1 ? second : undefined, operationId: operationId() });
  } finally { for (const ctx of contexts) await ctx.dispose(); }
});

test('two browsers can shake paws, type safely and play on a phone', async ({ browser, baseURL }, testInfo) => {
  localOnly();
  const options = testInfo.project.use;
  const a = await browser.newContext({ viewport: options.viewport, isMobile: options.isMobile, hasTouch: options.hasTouch });
  const b = await browser.newContext({ viewport: options.viewport });
  const page = await a.newPage(), guest = await b.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); guest.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${baseURL}/roulette`); await guest.goto(`${baseURL}/roulette`);
    await expect(page.locator('#join')).toBeVisible(); await page.locator('#join').click(); await guest.locator('#join').click();
    await page.bringToFront(); await expect(page.locator('#accept')).toBeVisible({ timeout: 8000 });
    await page.locator('#accept').click(); await expect(page.locator('#chat')).toBeHidden();
    await guest.bringToFront(); await guest.locator('#accept').click(); await page.bringToFront();
    await expect(page.locator('#chat')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.person')).toHaveCount(4);
    await page.locator('#yap').fill('<img src=x onerror=alert(1)> toast rights');
    await page.locator('#send').click(); await expect(page.locator('#messages')).toContainText('toast rights');
    expect(await page.locator('#messages img').count()).toBe(0);
    await page.locator('#yap').fill('draft survives refresh'); await page.waitForTimeout(3200);
    await expect(page.locator('#yap')).toHaveValue('draft survives refresh');
    await page.locator('#start').click(); await expect(page.locator('#board button')).toHaveCount(9);
    await page.locator('[data-cell="0"]').click(); await expect(page.locator('[data-cell="0"]')).toHaveText('🐟');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const targets = await page.locator('#board button').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().width)); expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath('roulette-connected.png'), fullPage: true });
    await page.locator('#leave').click(); await guest.bringToFront(); await expect(guest.locator('#connection-title')).toContainText('ended', { timeout: 8000 });
    await guest.locator('#leave').click(); expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test('embedded MCP Apps bridge preserves prefixed tools, drafts, and explicit agent prompts', async ({ page, request, baseURL }, testInfo) => {
  const resource = await (await rpc(request, baseURL, 'resources/read', { uri: 'ui://mjavmjav/roulette-v2.html' })).json();
  const markup = resource.result.contents[0].text;
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${baseURL}/mcp-host-test`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto(`${baseURL}/mcp-host-test`);
  await page.evaluate((markup) => {
    document.body.replaceChildren(); window.hostCalls = []; window.hostPrompts = [];
    const frame = document.createElement('iframe'); frame.id = 'widget'; frame.style.cssText = 'width:100%;height:1200px;border:0';
    const state = { me: { id: 'a', name: 'Soup Goblin' }, status: 'active', queueExpires: null, match: { id: 'match-1', phase: 'active', members: [{ id: 'a', name: 'Soup Goblin' }, { id: 'b', name: 'Cosmic Loaf' }], accepted: ['a','b'], expires: Date.now() + 60000, messages: [], game: null, revision: 1, reason: null } };
    window.addEventListener('message', (event) => {
      if (event.source !== frame.contentWindow || event.data?.jsonrpc !== '2.0') return;
      const msg = event.data;
      if (!msg.id) return;
      let result = {};
      if (msg.method === 'ui/initialize') result = { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1' }, hostCapabilities: {}, hostContext: { toolInfo: { tool: { name: 'cats_roulette_open' } } } };
      if (msg.method === 'tools/call') {
        window.hostCalls.push(msg.params);
        if (msg.params.name === 'cats_roulette_yap') { state.match.messages.push({ id: 'msg-1', participant: 'a', channel: 'app', text: msg.params.arguments.text, at: Date.now() }); state.match.revision++; }
        result = { structuredContent: state, content: [] };
      }
      if (msg.method === 'ui/message') window.hostPrompts.push(msg.params);
      frame.contentWindow.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
    });
    frame.srcdoc = markup; document.body.append(frame);
  }, markup);
  const widget = page.frameLocator('#widget');
  await expect(widget.locator('#chat')).toBeVisible();
  await widget.locator('#yap').fill('cat diplomat reporting for duty'); await widget.locator('#send').click();
  await expect(widget.locator('#messages')).toContainText('cat diplomat');
  await widget.locator('#ask').click();
  await expect.poll(() => page.evaluate(() => window.hostPrompts.length)).toBe(1);
  expect(await page.evaluate(() => window.hostCalls.every((c) => c.name.startsWith('cats_roulette_')))).toBe(true);
  expect(await page.evaluate(() => window.hostCalls.filter((c) => c.name === 'cats_roulette_say').length)).toBe(0);
  expect(await widget.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('roulette-mcp-host.png'), fullPage: true });
  expect(errors).toEqual([]);
});
