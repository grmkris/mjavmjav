# mjavmjav.com

**Live:** https://mjavmjav.com — also https://www.mjavmjav.com.

A deeply unserious cat with one shared brain cell. Tap the cat for a real meow,
pick one of nine synthetic noises, or unleash chaos. Keys **1–9** and **0** play
the soundboard; **Escape** stops it. Mute cuts off current and future audio.
Switching away from the tab stops chaos and playing sounds.

## Cat arcade

- **Flappy Mjav:** tap the game, tap Flap, or press Space to dodge cucumbers.
- **Boing Boing:** bounce automatically; steer with arrows, A/D, or touch buttons.
- Solo games have pause/resume and personal bests saved in this browser.
- Make a room and share the invite link for up to eight cats on the same course.
  The host picks a game and starts a three-second countdown. Late arrivals
  spectate until the next round. The oldest remaining cat becomes host if the
  host leaves. Each round ends when all cats bonk or after 75 seconds.
- Soundboard buttons send visible room reactions. Hear other players by enabling
  **hear the other cats**; global mute always wins. Remote sounds never echo back.

Rooms require no account, expire one hour after creation, and delete their
stored state automatically. Anyone with the code can join; names and colors
are assigned by the server. Solo play works without a network connection after
the page loads. The server runs the multiplayer physics and accepts controls,
not client-submitted scores. Rounds checkpoint once per second for recovery.

Plain HTML/CSS/JS, an original SVG mascot, canvas games, and Cloudflare Worker
static assets. One SQLite Durable Object per room coordinates WebSockets and
can hibernate while waiting in the lobby or between rounds.
No framework, build step, analytics, or runtime requests to third-party services.
All sounds require interaction; nothing starts playing on page load.

## Run and verify

```sh
bun install --frozen-lockfile
bun run check
bun run dev

# Once, if Playwright's browser is not installed:
bunx playwright install chromium
heavy bun run test

# Use an existing Chromium installation:
PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome heavy bun run test

# Run the same browser suite against production:
SITE_URL=https://mjavmjav.com heavy bun run test
```

Use `bun run test`, not `bun test`: the tests use Playwright's runner.
The browser suite covers desktop and 390px phone layouts, touch targets,
asset loading, real audio playback, immediate mute, all ten keyboard shortcuts,
both games, multiplayer rounds and host handoff, room capacity, reactions,
chaos cancellation, reduced motion, and controls without Web Audio support.
The local unit tests cover deterministic physics, countdowns, controls,
cucumber collisions, platform landings, and the round time limit.
These are browser checks; a physical iPhone has not been tested.

## Deploy

```sh
bun run deploy
```

`wrangler.jsonc` pins the account, Worker `mjavmjav`, static assets, and both
custom domains. Wrangler uses the existing protected `CLOUDFLARE_API_TOKEN`
environment; never put credentials in Git.

The initial binding replaced Namecheap's parking A record (`162.255.119.224`)
and `www` CNAME (`parkingpage.namecheap.com`) with Worker-managed DNS. The MX
and SPF records were preserved. `www` serves the page; the canonical URL is
`https://mjavmjav.com/`.

## Asset provenance

- `public/meow.wav`: **Meow of a Siamese cat**, by **freemaster2**, licensed
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
  [Wikimedia source and license review](https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav),
  [original Freesound recording](https://freesound.org/people/freemaster2/sounds/66518/).
  The original WAV is bundled unchanged. Other voices are synthesized with Web Audio.
- `public/fonts/bricolage-grotesque-latin.woff2`: **Bricolage Grotesque**, Latin
  variable font, downloaded from Google Fonts on 2026-10-15. Copyright 2022 The
  Bricolage Grotesque Project Authors. [Upstream](https://github.com/ateliertriay/bricolage),
  SIL Open Font License 1.1 in `public/fonts/OFL.txt`.
- Mascot and favicon: original SVG source in `public/index.html` and `public/cat.svg`.

## Agent setup

`AGENTS.md` is the master, `CLAUDE.md` links to it, and `.mcp.json` contains the
shared MySI and Cloudflare OAuth endpoints. Repoagents generates Claude, Codex,
Cursor, and Grok configuration. Auth and trust remain machine-local.

Seven relevant skills are vendored with pinned provenance in
`.agents/skills/sources.json`: frontend-design, good-css,
make-interfaces-feel-better, mobile-native, animate, wrangler, and durable-objects.
Run `bun run agents:check` after changing agent configuration.
