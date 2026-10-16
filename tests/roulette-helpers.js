import { randomBytes, createHash } from 'node:crypto';
export const operationId = () => randomBytes(16).toString('hex');
export async function rpc(request, baseURL, method, params = {}, token) {
  return request.post(`${baseURL}/mcp`, { headers: { Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data: { jsonrpc: '2.0', id: operationId(), method, params } });
}
export async function call(request, baseURL, token, name, args = {}) {
  const response = await rpc(request, baseURL, 'tools/call', { name, arguments: args }, token);
  if (response.status() !== 200) throw new Error(`MCP HTTP ${response.status()}`);
  const data = await response.json(); if (data.error) throw new Error(JSON.stringify(data.error)); return data.result;
}
export async function register(request, baseURL) {
  const response = await request.post(`${baseURL}/oauth/register`, { data: { redirect_uris: [`${baseURL}/oauth-test-callback`], token_endpoint_auth_method: 'none' } });
  if (response.status() !== 201) throw new Error(`Registration HTTP ${response.status()}`);
  return (await response.json()).client_id;
}
export async function authorize(request, baseURL, client) {
  const verifier = randomBytes(48).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = { client_id: client, redirect_uri: `${baseURL}/oauth-test-callback`, response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, resource: `${baseURL}/mcp`, scope: 'roulette', state: 'saved-state' };
  const page = await request.get(`${baseURL}/oauth/authorize?${new URLSearchParams(params)}`);
  const html = await page.text(); const flow = html.match(/name="flow" value="([a-f0-9]+)"/)?.[1];
  if (!flow) throw new Error(`No consent form (HTTP ${page.status()})`);
  const consent = await request.post(`${baseURL}/oauth/authorize`, { headers: { Origin: baseURL }, form: { flow, decision: 'allow' }, maxRedirects: 0 });
  const redirect = new URL(consent.headers().location); if (redirect.searchParams.get('state') !== 'saved-state' || redirect.searchParams.get('iss') !== baseURL) throw new Error('OAuth state/issuer mismatch');
  return { code: redirect.searchParams.get('code'), verifier, client };
}
export const tokenForm = (baseURL, grant) => ({ grant_type: 'authorization_code', code: grant.code, code_verifier: grant.verifier, client_id: grant.client, redirect_uri: `${baseURL}/oauth-test-callback`, resource: `${baseURL}/mcp` });
export async function connect(request, baseURL, client) {
  const grant = await authorize(request, baseURL, client);
  const response = await request.post(`${baseURL}/oauth/token`, { form: tokenForm(baseURL, grant) });
  if (response.status() !== 200) throw new Error(`Token HTTP ${response.status()}`);
  return response.json();
}
