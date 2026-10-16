# Bonk Club

A simultaneous-turn catfight for 2–8 people in the existing global room. Each cat
has three hearts and two shields. For eight seconds, players privately pick a
move to an adjacent tile (including diagonals) and either a fish target or a
shield. All moves resolve before all attacks. Fish hit a cross of five tiles;
diagonal movement lets cats evade attacks aimed at their previous position.
Fish can hit their thrower. Missing a turn means standing still without a shield.

The game ends after eight turns or when at most one cat remains. Most remaining
hearts wins, with successful hits breaking ties. Simultaneous knockouts are a
draw. Solo practice contains two explicitly named bots; global games never add
bots or start with a lone human.

## Protocol

The existing Cloudflare Durable Object owns the clock, validates plans, and
resolves combat. A `plan` message carries `round`, `turn`, `move`, and `target`
(`null` for a shield). The socket identity determines the player. An immediate
`plan-ack` confirms acceptance. Accepted plans cannot be replaced. Only readiness
is public; every broadcast passes through `publicGame()` to remove private plans.
Full snapshots, including secret plans, are checkpointed in Durable Object storage.

Bonk maps broadcast twice per second and immediately at turn transitions, compared
with ten frames per second for the reflex games. Clients draw their selection
immediately but never predict shared combat. A delayed packet has the same turn
window; arrival after the server deadline is rejected. This reduces sensitivity
to network delay, but does not guarantee play through a disconnection.

Existing v2 race snapshots remain readable; new snapshots use v3. The existing
global object, routes, domains, and storage schema are reused.

## Interface review

Full review scoped to Bonk Club in the existing plain HTML/CSS/canvas system.
The map is the main visual: a pink tabletop, cream tiles, numbered cats, green
move selection, pink aim splash, and orange resolved hits. Bricolage Grotesque
and the existing plum/lime controls maintain the arcade's visual language. A
6×6 grid keeps each map target over 44px at a 390px phone width.

| Category | Evidence | Result |
| --- | --- | --- |
| Typography | Map labels, tool buttons, timer, plan confirmation, accessible tile names | Tabular timer; explicit move, fish, shield, lock labels |
| Surfaces | Map overlay and canvas geometry; tools and pause row | 36 aligned tile buttons; keyboard arrows and visible focus |
| Animations | Planning and reveal states | Immediate selection and simultaneous reveal; no new animation sequence |
| Icons | Existing canvas cat; original fish drawing; labelled tools | Color is paired with cat numbers, names, coordinates, and hearts |
| Performance | Worker frames, plan acknowledgement, client updates | Reduced Bonk broadcast frequency; no client combat prediction; unchanged DOM text skipped |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `public/game-core.js`, `src/worker.js` | Games compared survival scores | Secret simultaneous plans with server-resolved attacks and shields | Actual interaction between players without a reflex contest |
| MEDIUM | `public/bonk-ui.js`, `public/styles.css` | Canvas alone cannot expose a clickable map to keyboard users | 36 labelled buttons with arrow navigation and focus ring | Touch targets and keyboard access |
| MEDIUM | `public/arcade.js`, `public/index.html` | Bonk mode hid solo pause along with reflex controls | Pause sits beside the Bonk turn status | Practice can resume after switching tabs or pressing Escape |
| MEDIUM | `public/game-render.js` | Only the aimed tile was outlined | Entire cross-shaped splash is shown before lock-in | Players can understand friendly fire and dodge space |
| MEDIUM | `public/styles.css` | Four game tabs pushed the phone arena down | Compact labels preserve the first-screen arena | Main game keeps priority |

Considered and rejected: a new networking framework would add a migration without
helping this turn-based protocol; decorative motion on each tile selection would
compete with planning. No slowed-animation review applies to the new static map.
Physical iPhone/Android behavior, Safari, real cross-continent latency, and large
crowds require separate verification.

Cloudflare references: [WebSocket lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
and [Workers deployment permissions](https://developers.cloudflare.com/workers/authorization/workers/).

## Verification and deployment — 2026-10-16

- `bun run check`: **17 passed**, zero failures; six JavaScript syntax checks and
  repoagents passed.
- Local full browser run: **33 passed**, one timing-dependent Bonk test failed
  when a reveal expired between assertions. The test now retains server reveal
  messages and submits concurrent plans without competing browser focus.
- `PLAYWRIGHT_EXECUTABLE_PATH=/home/kristjan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome heavy bun run test tests/bonk.spec.js --output test-results/bonk-final`:
  **4 passed**, zero failures, on desktop and 390px touch emulation. This covers
  map/keyboard controls, pause/resume, bot practice, waiting/cancel/join,
  spectators, private plans, a 600ms delayed submission, simultaneous damage,
  shields, and winners. The 30 existing regression cases passed in the full run.
- Reviewed desktop and 390px planning screenshots, desktop reveal screenshot,
  and the four-game phone opening screen. Map tiles meet the 44px minimum.
- `bunx wrangler deploy --dry-run`: passed with the existing Durable Object and
  asset bindings.
- Source commits: `a5b3abe`, `fb3c212`, `fc4012c`, `98def6d`, pushed to `main`.
- `bun run deploy`: version `5d745ea3-833a-4e1d-aec1-04ec492933e4`, both custom
  domains. Browser-like HTTP requests return 200 with Bonk Club on the page;
  all five changed script/style asset hashes match local source on both domains.

**Interface verdict: Approve within the reviewed Chromium scope.** Physical
phones, Safari, real cross-continent latency, and load testing remain unverified.
