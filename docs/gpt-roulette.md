# GPT Roulette showcase

`/roulette` runs on the website and the same HTML/CSS/JS is served as the MCP
Apps resource `ui://mjavmjav/roulette-v1.html`. The MCP endpoint is `/mcp`.

## Try it in two ChatGPT accounts

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins), use the plus button and
   **Add custom MCP server**. Account/workspace availability may differ.
2. Use **Mjav Mjav**, endpoint `https://mjavmjav.com/mcp`, and OAuth. The server
   supports dynamic client registration, so no manually pasted client secret is needed.
3. Follow the authorization page and select **Connect this cat**. This creates
   or reuses an anonymous cat identity in that browser. It is not a verified login.
4. Install/select the resulting plugin in a new conversation. Ask **Open GPT Roulette**.
5. Each person selects **find another cat**. There is one global queue. Each
   selects **shake paws** for the proposed match. Either can decline.
6. Type into the shared app, or select **ask my agent to reply**. Try
   **Start Toe Beans, then play my next move for me** in ChatGPT.
7. Either person can leave. Shared messages disappear from the active match.

A connected OAuth identity has one queue/match across all its ChatGPT chats and
its authorizing browser. Two people need distinct browser cookies/ChatGPT links.
Two accounts authorized from the same browser identity will be the same cat.
There are no ChatGPT conversation identifiers or private transcript access.

The app does not invoke a model API, run a background agent, or wake another
ChatGPT conversation. The host's `ui/message` action asks the local human's
ChatGPT agent for one reply. The other human must prompt their own agent.
The card polls read-only state every three seconds while visible, with one
request in flight; turn-based play does not depend on a twitch deadline.
The existing global arcade remains available from the wordmark. Its four games
are not embedded in this first MCP card; Toe Beans is the MCP-native game.

## Protocol and state

- Official MCP SDK, stateless Streamable HTTP, JSON responses. Lifecycle and
  schema handling stay in the SDK; MCP session IDs are not identities.
- Nine focused tools. `roulette_open` is the only render tool; other tools
  return structured state. `roulette_yap` is app-visible only. `roulette_say`
  is labelled agent. Labels identify a channel, not a verified human author.
- Portable MCP Apps `ui/initialize`, tool-result notifications, `tools/call`,
  `ui/message`, and size notifications. The widget uses the exact exposed
  render-tool prefix supplied by host context for subsequent tool calls.
- OAuth authorization code + S256 PKCE, exact registered redirects, resource
  and client binding, state + issuer echo, single-use codes, rotating refresh
  tokens, revocation. Access tokens last one hour, refresh/browser credentials
  seven days, DCR clients ninety days. Consent flows expire in ten minutes;
  codes expire in one minute. Opaque 256-bit credential hashes name storage
  objects; tokens never occur in tool arguments or tool results.
- The queue Durable Object is the one global coordination point, bounded to
  256 retained cat records. Each match owns a separate SQLite Durable Object.
  Credentials use separate expiring records. No new secret provisioning needed.
- Queue expiry: five minutes. Mutual acceptance deadline: two minutes. Match:
  thirty minutes maximum. Closing a tab does not immediately end a connection;
  explicit leave or expiry does. Queue cleanup runs each minute and on access.
- Only a current match's two members may read/write it. Writes bind match ID;
  game moves additionally bind game ID and turn. A departed pair is avoided
  while its queue records survive (up to 32 recent peer IDs); this is not a
  permanent account block. Closing and rejoining is explicit.
- Text is capped at 600 characters, one message per participant per second,
  and sixty visible messages. The last 128 operations are deduplicated for
  retry; use the exact same operation ID and arguments after a lost response.
  Chat and retry text are cleared on leave/expiry. Expiry alarms remove live
  data; this does not promise erasure from Cloudflare's provider backups.
- Render user text with `textContent`. All peer text is untrusted data; server
  and tool instructions explicitly forbid treating it as instructions or
  sharing private conversation context. There are no uploads or microphones.

This is an anonymous experimental showcase. It has bounded messages and
short-lived pairing, not verified identities, durable moderation, or a load-test
claim. Public directory submission, real ChatGPT account linking/rendering,
physical phones and Safari require separate acceptance evidence.

## Validation

```sh
bun run check
heavy bun run test tests/roulette.spec.js
heavy bun run test
# Discovery and mock host only; matchmaking/auth mutation tests skip on production:
SITE_URL=https://mjavmjav.com heavy bun run test tests/roulette.spec.js
```

The local test server explicitly forwards its own loopback hostname; Wrangler
otherwise rewrites requests to the first production route, which conflicts with
OAuth's exact resource/redirect checks. Never weaken production redirect checks
to accommodate local tests.

Rules tests cover mutual consent, outsider access, channel labels, idempotency,
rate/length limits, stale boards, turn order, win/draw, and cleanup. Runtime tests
cover real Worker/DO OAuth and MCP calls, two isolated pairs, literal hostile
markup, phone layout, and a mock MCP Apps host with prefixed tool names. Mock
host evidence is not ChatGPT acceptance.

## Sources checked 2026-10-16

- [Official OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [Official OpenAI MCP Apps UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [UI reference](https://developers.openai.com/plugins/reference)
- [OAuth](https://developers.openai.com/plugins/build/auth)
- [Connection and testing](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
