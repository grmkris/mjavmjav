# mjavmjav.com

**Live:** https://mjavmjav.com — also https://www.mjavmjav.com.

A deeply unserious cat with one shared brain cell. Tap the cat for a real meow,
pick a synthetic noise, or unleash chaos. Keys **1–4** play the soundboard;
**Escape** stops it. Mute cuts off current and future audio. Switching away from
the tab stops chaos and playing sounds.

Plain HTML/CSS/JS, an original SVG mascot, and Cloudflare Worker static assets.
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
The 12 browser cases cover desktop and 390px phone layouts, touch targets,
asset loading, real audio playback, immediate mute, keyboard shortcuts,
chaos cancellation, reduced motion, and controls without Web Audio support.
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

Six relevant skills are vendored with pinned provenance in
`.agents/skills/sources.json`: frontend-design, good-css,
make-interfaces-feel-better, mobile-native, animate, and wrangler.
Run `bun run agents:check` after changing agent configuration.
