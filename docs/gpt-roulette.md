# GPT Roulette showcase

`/roulette` runs on the website and the same HTML/CSS/JS is served as the MCP
Apps resource `ui://mjavmjav/roulette-v2.html`. The MCP endpoint is `/mcp`.

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
8. **Preview camera** requests camera permission and shows a private preview.
   After the pawshake, **Share camera** joins the video call. **Enable mic** and
   **Turn sound on** are separate opt-ins. **Stop camera** stops every local track.
   If ChatGPT blocks capture, **Open camera in browser** opens the same match's
   camera in a separate tab, including on a browser without the original identity cookie.

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

## Open from Goblin

Add `https://mjavmjav.com/mcp` in Goblin Connections, connect an anonymous cat,
and allow `roulette_open` and `roulette_status`. The open tool declares the
OpenAI MCP Extensions global entrypoint, so Goblin can pin the connection in its
sidebar and open it in its own thread without a model call. Other tools retain
their individual host grants. Opening the app never joins matchmaking.
MCP initialization requests OAuth before reporting the connection ready. Public
tool/resource inspection remains available; every tool call requires identity.

Goblin currently runs MCP Apps in opaque sandbox frames, which prevent browser
camera capture. Use **Open camera in browser** after a pawshake; Goblin presents
the external link for the person to open. The scoped camera capability works
without moving the Goblin session or OAuth identity into the new page.

## Protocol and state

- Official MCP SDK, stateless Streamable HTTP, JSON responses. Lifecycle and
  schema handling stay in the SDK; MCP session IDs are not identities.
- Ten focused tools. `roulette_open` is the only render tool; other tools
  return structured state. `roulette_yap` and `roulette_camera` are app-visible only. `roulette_say`
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
  Credentials use separate expiring records. Camera calls use the Worker secrets
  `TURN_KEY_ID` and `TURN_KEY_TOKEN`; see [Loaf cam](loaf-cam.md).
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
  sharing private conversation context. Camera and optional microphone media use
  WebRTC; no media is recorded, uploaded to a model, or stored in a Durable Object.

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

## Deployment receipt — 2026-10-16

- Rules commit: `295fc50`; application commit: `20364ab`.
- Cloudflare Worker: `mjavmjav`, account `bceaeae4788dce3493514fde194b4a7e`.
- Deployed version: `b4c3c5ef-84a0-49fa-b0fe-21a6ce9f49a8`.
- Local checks: **23 unit tests passed**, repoagents passed.
- Complete local browser suite: **44 passed**, desktop and 390px phone.
- Integrated checkout: frozen install, 23 unit tests, two embedded-host tests,
  and deployment dry run passed. The final compact-heading whitespace fix is
  covered by the integrated embedded-host rerun.
- Live MCP suite: **4 passed, 6 intentionally skipped**. Discovery/resource and
  mock-host checks ran on desktop and phone; pairing, message and game mutations
  stayed local. Mock-host screenshots are not real ChatGPT rendering evidence.
- Both domains returned 200 for `/`, `/roulette`, and OAuth discovery.
- Live `index.html`, `roulette.html`, `roulette.css`, and `roulette.js` matched
  committed bytes. Font CORS permits the embedded component to load its font.
- A fresh production identity completed consent + PKCE + token exchange and
  authenticated `roulette_open` with idle state. The smoke credentials were
  revoked afterward. It did not join the queue or send messages.
- **Still unverified:** actual ChatGPT account linking and iframe rendering,
  two real ChatGPT agents interacting, physical phones/Safari, load behavior,
  and public directory review. The endpoint is ready for that acceptance pass.
