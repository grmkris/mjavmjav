# mjavmjav.com

**Live:** https://mjavmjav.com — also https://www.mjavmjav.com.

A deeply unserious cat with one shared brain cell. Tap the cat for a real meow,
pick one of nine synthetic noises, or unleash chaos. Keys **1–9** and **0** play
the soundboard; **Escape** stops it. Mute cuts off current and future audio.
Switching away from the tab stops chaos and playing sounds.

## Cat arcade

- **Flappy Mjav:** tap the game, tap Flap, or press Space to dodge cucumbers.
- **Boing Boing:** steer across narrower toast with arrows, A/D, or touch buttons.
  Orange toast crumbles for each cat separately; the rising floor punishes camping.
- **Honk Dodge:** steer away from falling geese. The flock gets faster and denser;
  ten points count as one second survived.
- **Bonk Club:** a simultaneous-turn PvP catfight on a shared 6×6 map. Move one
  tile (diagonals included) and aim a fish, or use a shield, within eight seconds.
  Secret plans reveal together: fish hit their target and four adjacent tiles, including the thrower.
  Three hearts, two shields, eight turns. Most hearts wins; hits break ties.
  The global round waits for at least two humans (up to eight); **practice vs bots**
  is explicitly solo. Missing a deadline leaves your cat exposed where it stood.
- The arcade opens first, with a nearly full-width phone arena and large thumb controls.
- Solo games have pause/resume and personal bests saved in this browser.
- Every visitor automatically joins **one global lobby**, on both domains. No room
  codes, invite screens, accounts, or host. Old room links now land here too.
- Press **play together** once to start a five-second countdown. Friends can
  **join this round** until its final half-second, with up to eight cats per race.
  During a race, **play next round** queues you automatically. Waiting cats launch
  four seconds after the round ends; the oldest waiting cat picks the game.
  **Leave queue** cancels your place. Spectators can watch and make sounds.
  Racers opt in again each round. Arcade races end when all cats bonk or after
  75 seconds; Bonk Club ends with one survivor or after eight turns.
- **Practice solo** keeps you in the lobby and sound stage while you play locally.
  Solo play works without a network connection after the page loads.
- Every soundboard press appears on the **global yap stage**. Enable **hear the
  other cats** for live audio. **Echo** deliberately performs a recent sound again;
  passive playback never rebroadcasts. Global mute and hidden-tab silence win.
- Disconnected visitors reconnect automatically. Their race seat is released and
  they can rejoin the queue. The lobby itself never expires.

The server assigns names, runs multiplayer physics, and accepts controls rather
than client-submitted scores. Games checkpoint once per second. The global stage
persists only its last twelve sound events; six are shown, and joining never
replays history aloud. Sound broadcasts allow one per cat every 700 ms and at
most four globally per second. The lobby currently accepts up to 256 simultaneous
connections, including eight racers; this is an application bound, not a load-test
claim. The global arcade has no microphone recordings, uploads, or free-form chat.
GPT Roulette has a separate, mutually accepted two-person text chat.

Plain HTML/CSS/JS, an original SVG mascot, canvas games, and Cloudflare Worker
static assets. One SQLite Durable Object named `global` coordinates `/api/room`
WebSockets across both domains and hibernates between activity. The old private-room
API is removed; existing private objects retain their one-hour cleanup alarm.
The canvas skips painting while offscreen or hidden. Roster elements are reused
between game snapshots; unchanged score/status labels avoid extra DOM writes.
No framework, build step, analytics, or runtime requests to third-party services.
All sounds require interaction; nothing starts playing on page load.

## GPT Roulette and ChatGPT MCP app

[Open GPT Roulette](https://mjavmjav.com/roulette): one global matchmaking queue,
a mutual pawshake, two human seats and two companion-agent seats, shared text,
and **Toe Beans** (fish-vs-toast tic-tac-toe). The turn-based game works at chat
speed. Leaving ends the connection and clears its shared messages.

Connect `https://mjavmjav.com/mcp` as a custom MCP server in ChatGPT with OAuth,
then ask **Open GPT Roulette**. Each person links their own anonymous cat identity.
Agents reply when their human asks; there is no autonomous agent-to-agent loop.
The existing arcade and the pair's conversation use separate Durable Objects.

See [setup, protocol, limits and acceptance](docs/gpt-roulette.md). Real ChatGPT
linking/rendering must be verified separately from the local MCP/browser harness.

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

# Run production-safe checks (race sequencing and spam probes stay local):
SITE_URL=https://mjavmjav.com heavy bun run test
```

Use `bun run test`, not `bun test`: the tests use Playwright's runner.
The browser suite covers desktop and 390px phone layouts, touch targets,
asset loading, real audio playback, immediate mute, all ten keyboard shortcuts,
all four games, private PvP plans, simultaneous fish hits, two-human matchmaking,
solo bot practice, one-tap countdown entry, automatic FIFO seats with eleven visitors,
queue cancellation, roster reuse across frames,
shared sounds and explicit echoes, reconnects, rate limits, origin validation,
chaos cancellation, reduced motion, and controls without Web Audio support.
The local unit tests cover deterministic physics, countdowns, controls,
cucumber and goose collisions, reachable platform gaps, per-cat crumbling toast,
idle-player elimination, increasing dodge difficulty, and the round time limit.
Bonk tests cover hidden plans, invalid and duplicate moves, shields, evasion,
mutual knockouts, unique spawns, bot practice, and the eight-turn limit.
Bonk snapshots broadcast twice per second and immediately on turn changes;
plan acknowledgements are immediate and only the server resolves combat.
The live suite skips race/capacity/spam probes and suppresses soundboard-regression
broadcasts. A small multi-client sound test still exercises real shared audio.
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
