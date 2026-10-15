# Pocket arcade UI review — 2026-10-16

## Scope and design

Full review of the arcade, multiplayer entry, and adjacent sound controls. Plain
HTML/CSS/JavaScript and canvas, using the existing CSS tokens and Bricolage
Grotesque. The existing soundboard and mascot remain below the arcade. Evidence
is Chromium desktop (1440×900) and touch emulation (390×844), not physical phones.

The visual direction is a pocket arcade: the playable cat gets the first screen;
controls sit under the arena where thumbs can reach them. The established palette
is plum `#171229`, cream `#fff4d6`, lime `#ddff45`, pink `#ff91d1`, mint `#76ead2`,
and orange `#ffad70`. Bricolage carries headings and controls; existing monospace
faces stay on the soundboard and tiny keyboard hints. Copy and controls are left
aligned outside the arena; the opening game invitation is centered.

```text
Phone                         Desktop
brand          mute           brand                         mute
small title    cats online    small title             cats online
[Flappy] [Boing] [Honk]        [game picker]     shared brain cell
+---------------------+       +-------------+   four quick sounds
|                     |       |             |   listen / crowd
|     large arena     |       | large arena |   recent sounds
|   play together     |       |             |
|       / solo        |       +-------------+
+---------------------+       thumb controls
thumb controls                play together / solo
play together / solo
queue / short help
shared sounds and crowd
```

Brief check: the earlier oversized mascot-first introduction delayed play.
Moving the actual arcade ahead of it is specific to this game site. The first
visual pass also exposed a desktop play button below the fold; a matching primary
action now sits inside the opening arena. The game retains its unusual cat,
cucumber, toast, and goose drawings instead of acquiring generic game-library UI.

## Coverage

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Heading hierarchy, game invitation and help, HUD, status and queue text in HTML/CSS and screenshots | Smaller introductory heading; balanced game titles; tabular counters; clearer labels |
| Surfaces | Arena, nested corners, game picker, touch controls, queue, roster details and sound stage | Wider phone arena, concentric corners, primary multiplayer action, visible focus and 44px targets |
| Animations | Instant game-control press states, hover capability queries, reduced-motion browser check, existing mascot orbits | No new animation dependency or entrance choreography; hardware motion not verified |
| Icons | Existing cat SVG, text-labelled steering arrows, four labelled reaction faces, canvas cats/geese | Existing icon language retained; no unlabeled icon-only actions added |
| Performance | Canvas paint path, roster rendering, HUD writes, Durable Object frame handling and queue timers | Offscreen/hidden paint skipped; roster nodes reused; unchanged labels not rewritten; no latency benchmark claim |

## Findings addressed

### Hierarchy, typography, and immediate feedback

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `public/index.html:26`, `public/styles.css:162` | Arcade followed a large mascot hero | Arcade is first, with compact heading and three game choices | Primary user path must be immediately discoverable |
| MEDIUM | `public/styles.css:167`, `public/styles.css:174` | Large phone gutters and small arena | 350px arena at 390px viewport; wider desktop canvas; 20px shell around 12px viewport with 8px padding | More usable game area and concentric corners |
| HIGH | `public/index.html:39`, `public/arcade.js:195`, `src/worker.js:108` | Queue and launch were separate actions | Play together starts a countdown; friends join it directly; waiting cats enter the next round automatically | Clear action and confirmation without an unnecessary manual launch step |
| MEDIUM | `public/arcade.js:195`, `public/index.html:43` | Queue, racing and connecting states used scattered controls | Matching play buttons show joining, queued, countdown, racing and reconnecting states; cancellation stays explicit | Predictable control state and readable recovery |
| MEDIUM | `public/styles.css:175`, `public/styles.css:181` | Dense mono help and an oversized introductory heading | Smaller heading, readable game help, balanced overlay title, tabular online/score counters | Clear hierarchy and stable dynamic numbers |

### Touch targets, focus, and surfaces

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `public/styles.css:188`, `public/styles.css:197` | Game actions competed with room administration | 48px thumb controls and play row, separate solo practice, focus ring on canvas | Minimum hit area and clear primary action |
| MEDIUM | `public/index.html:48`, `public/styles.css:203` | Room administration and full roster occupied the adjacent panel | Four quick sounds, listening toggle, expandable roster and compact sound stage | Keep common interactions close and disclosure secondary |
| LOW | `public/styles.css:215`, `public/styles.css:252` | New details control had no explicit focus treatment | Focus/press treatment, hover gated by pointer capability, reduced-motion press override | Consistent keyboard and touch feedback |

### Performance and game feedback

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | `public/arcade.js:125`, `public/arcade.js:195` | Every frame recreated roster nodes and rewrote the score; canvas painted offscreen | Reuse roster nodes, write changed text only, skip hidden/offscreen painting | Avoid repeated DOM and paint work during play |
| MEDIUM | `public/game-core.js:13`, `public/game-core.js:117`, `public/game-render.js:66` | Two games; forgiving stationary jumping | Honk Dodge plus narrower, spaced toast, per-cat crumble, rising danger and visible hazard feedback | A distinct third game and meaningful jump challenge |

## Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Arcade page | Fixed fullscreen shell and floating controls | Would hide or cover the sound stage; natural scrolling keeps the whole toy accessible |
| Multiplayer client | New networking framework or prediction rewrite | User requested only easy performance gains; current server authority and local prediction already work |
| Game controls | Animated bounce and glow on every input | Repeated effects would compete with the cat and hazards; immediate press feedback is sufficient |

## Verification

- `bun run check`: 10 physics tests passed; all five scripts passed syntax checks; repoagents passed.
- `bunx wrangler deploy --dry-run`: Worker packaging and existing bindings passed.
- `PLAYWRIGHT_EXECUTABLE_PATH=/home/kristjan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome heavy bun run test --output test-results/local`: 30 passed, 0 skipped, 0 failed.
- Inspected desktop and 390px screenshots of the opening arena, sound stage,
  active Boing Boing and active Honk Dodge. Phone arena is 350px wide; thumb
  controls and the bottom play button fit within the 844px first screen.
- Browser interactions cover solo/paused/rematch, connecting/reconnecting,
  countdown admission, racing/spectating, queue/cancel, automatic next round,
  sound listening/mute/echo, keyboard controls and reduced motion.
- New arcade press feedback is immediate. No new animated sequence was introduced;
  the existing mascot's 10%-speed motion review was not performed.
Physical iPhone/Android behavior, Safari rendering, cross-continent latency and
256-connection load remain unverified. The connection cap is a product bound.

**Verdict: Approve within the reviewed Chromium scope.** No actionable UI findings
remain. The hardware, Safari, latency, load and slowed mascot-animation checks
listed above remain unverified.

## Deployment receipt

- Feature source: `b0bf991` (preceded by physics commit `1701b63`), pushed to `main`.
- `bun run deploy`: succeeded for Worker `mjavmjav`, both custom domains,
  version `27212edc-3e52-49f2-ab12-2825575b12f1`.
- Direct public fetches of `/` and `/game-core.js` on `mjavmjav.com` and
  `www.mjavmjav.com`: HTTP 200; new heading, one-tap action, Honk Dodge and
  physics version 2 present.
- `SITE_URL=https://mjavmjav.com PLAYWRIGHT_EXECUTABLE_PATH=/home/kristjan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome heavy bun run test --output test-results/live`:
  **22 passed, 8 intentionally skipped, 0 failed**. Shared audio/echo and lobby
  checks crossed the apex and www domains. Race sequencing, capacity,
  queue-cancellation and spam tests ran locally only to avoid taking over the
  live global room.
