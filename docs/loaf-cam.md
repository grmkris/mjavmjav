# Loaf cam

Roulette has opt-in two-person camera calls on the website and in the MCP App.
The camera is initially off. Previewing opens only a local video track; sharing
requires an active, mutually accepted match. Microphone capture and remote sound
each require their own button. Leaving, closing the page, hiding it, losing the
signaling connection, or reaching the match deadline stops the local tracks.
Peer stop removes its picture while the remaining participant can wait for a rejoin.

## Protocol

- The MCP resource requests `_meta.ui.permissions.camera` and `microphone`.
  The host may decline. No camera API is called before the human taps Preview.
- `roulette_camera` is app-visible only. It returns a match- and session-bound
  bearer capability exclusively in result `_meta.camera`, never in model-visible
  `content` or `structuredContent`. It does not start capture or join a call.
- The website prepares the same capability using a same-origin, cookie-authenticated
  POST to `/api/roulette-camera/session`. Creation is limited to six per cat per minute.
- The UI calls `/api/roulette-camera` with the capability in Authorization and no
  cookies. The capability expires with the match (at most 30 minutes). Every request
  checks that the match remains active and the participant belongs to it.
- `config` returns expiring ICE credentials; `open`, `poll`, `signal`, and `close`
  coordinate a session. The first match member offers, the second answers.
  Offers and answers contain gathered ICE candidates and are bound to both exact
  camera session IDs. Peer replacement discards the previous connection.
- Camera state lives in a separate SQLite table in each RouletteMatch object.
  It never enters `roulette_status` or chat history. Each participant has one live
  session; duplicate tabs cannot silently take over a camera. A 20-second heartbeat
  lease expires silent sessions on access; match cleanup removes the table data.
- Signaling bodies are capped at 32 KiB, SDP at 24,000 characters, and each camera
  session at twelve updates per second. Normal polling is 800 ms during negotiation
  and two seconds when connected, with only one request in flight. A 15-second local
  watchdog stops capture if signaling stalls. No model polling loop is involved.

## Media and relay

Production uses native WebRTC with `iceTransportPolicy: "relay"` and Cloudflare
Realtime TURN, so participants connect through the relay rather than exchanging
direct public IP addresses. The Worker issues ICE credentials server-side with a
TTL bounded by the match. The long-lived TURN key is never returned to a client.
WebRTC encrypts the media between participants; neither the Worker nor TURN
decodes it. The implementation has no recorder, transcription, or model media input.
Participants' own devices can still capture what they receive.

Video requests 640×480 at 20 fps (maximum 24 fps) and a 600 kbps sender limit.
Audio requests echo cancellation and noise suppression only when enabled.
Local loopback development uses direct WebRTC without a relay for fixtures;
production fails explicitly if TURN credentials are missing or unavailable.

Cloudflare resource: TURN key `42ddc8e7b75aaf53b6020d511ff97758`, named
`mjavmjav-roulette`, account `bceaeae4788dce3493514fde194b4a7e`.
Secrets `TURN_KEY_ID` and `TURN_KEY_TOKEN` belong to Worker `mjavmjav`.
Preserve them on deploy. Rotate through Cloudflare; never put values in Git or logs.
TURN is metered separately from Workers; see the current provider pricing.

## Browser fallback

The embedded app opens `/roulette-camera` with the scoped capability in a URL
fragment using `ui/open-link`. The fragment is removed from browser history on
load and never sent in HTTP requests or referrers. The page has no third-party
scripts. It grants access only to that match's camera, not the OAuth identity,
chat, games, queue, or other matches. It still requires preview and explicit sharing.
Refreshing the fallback requires opening a fresh link from Roulette.

## Acceptance

```sh
heavy bun run check
heavy bun run test tests/roulette-video.spec.js tests/roulette.spec.js
heavy bun run test
heavy bunx wrangler deploy --dry-run
```

Browser tests use synthetic camera/microphone devices, actual RTCPeerConnections,
decoded remote frames and inbound audio counters. They cover desktop and 390px,
mute/stop/rejoin/leave, late permission cancellation, hidden MCP metadata,
cookie-free fallback, and both blocked and permitted iframe camera policies.
These fixtures establish app behavior, not ChatGPT host support or physical-device
behavior. Actual ChatGPT permissions, mobile Safari hardware and real-user calls
need their own evidence.

Sources:
- [MCP Apps permissions](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [ChatGPT UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Cloudflare TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [Cloudflare TURN privacy](https://developers.cloudflare.com/realtime/turn/faq/)

## Deployment receipt — 2026-10-16

- Signaling core: `c5e3f79`; camera application: `189ffff`, published on `main`.
- Worker `mjavmjav`, account `bceaeae4788dce3493514fde194b4a7e`.
- Version `e89a7833-f8c8-4bfa-b7ca-968b656f964d` serves 100% of traffic on
  `mjavmjav.com` and `www.mjavmjav.com`; the deployment status was read back.
- Local predeployment checks: **28 unit tests passed**, repoagents passed,
  **52 browser tests passed** across desktop and 390px phone. The browser checks
  include decoded video and optional audio in both directions, track cleanup,
  fallback links, and denied/permitted iframe camera policies.
- Deployment dry run passed before publishing. Production packaged 20 static
  files and uploaded six changed camera/UI assets.
- Seven public pages/scripts on each domain returned 200 and matched local
  SHA-256 hashes: homepage, Roulette HTML/CSS/JS, camera module, and fallback HTML/JS.
- Both domains returned valid OAuth discovery. Live MCP reads confirmed ten
  tools, app-only `roulette_camera`, resource `ui://mjavmjav/roulette-v2.html`,
  camera/microphone permissions, and the bundled camera implementation.
- `TURN_KEY_ID` and `TURN_KEY_TOKEN` remain configured after deployment; only
  their names and binding types were inspected.
- Final postdeployment gate: **28 unit tests passed**, repoagents passed.
  `SITE_URL=https://mjavmjav.com bun run test tests/roulette.spec.js tests/roulette-video.spec.js`
  completed with **4 passed, 14 intentionally skipped**, zero failures. The
  production discovery/resource and mock-host checks ran on desktop and phone;
  OAuth mutation, pairing, and media-call tests remained local-only.
- Public matchmaking, messages, and media calls were not exercised during
  deployment verification. Local media fixtures use direct loopback WebRTC,
  so they do not prove production TURN transport.
- Actual ChatGPT linking, camera permissions/rendering, production relayed media,
  and physical/mobile Safari devices still need a two-person acceptance run.
