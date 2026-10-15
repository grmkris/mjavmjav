# mjavmjav.com agent instructions

Master instructions. `CLAUDE.md` links to this file; edit `AGENTS.md`.

This is a playful cat soundboard and arcade for `mjavmjav.com`. Keep the project
small: HTML, CSS, browser JavaScript, canvas games, and an SVG mascot. A Cloudflare
Durable Object coordinates each multiplayer room; solo games stay in the browser.

## Stack and commands

- Plain HTML/CSS/JS in `public/`; no framework and no build step.
- Cloudflare Worker static assets, configured in `wrangler.jsonc`.
- Use Bun for scripts. `bun run check` runs the local checks; `bun run dev` previews;
  `bun run deploy` deploys the Worker and its custom domain.
- Run `heavy bun run test` for the desktop and 390px browser suite. Use
  `SITE_URL=https://mjavmjav.com` to run it against the live site.
  `bun test` invokes Bun's runner; use `bun run test` for Playwright.
- Work on `main`. Commit each coherent, verified change. Stage explicit paths only.
  Never stash, reset, restore, or blanket-stage another agent's work.
- Run `bunx repoagents@1 check` after changing agent configuration.

## Product constraints

- The page should feel like an intentionally silly internet artifact: loud, warm,
  weird, and quick to understand. Keep the cat as the visual focus.
- Bundle audio and font files locally with license provenance. The main meow is
  a CC0 recording; the other sounds use Web Audio. Do not add remote audio,
  tracking, or third-party runtime dependencies.
- Every sound action has a visible label and a mute control. Keyboard shortcuts are
  documented and must not be the only way to use the soundboard.
- Respect `prefers-reduced-motion`, visible keyboard focus, 44px touch targets, and
  mobile widths down to 390px. Gate hover rules behind a hover-capable pointer query.
- Keep copy harmless and silly. Do not use hateful or demeaning language toward
  people or protected groups.

## Agent skills

Start with `frontend-design` for visual direction, `good-css` for layout and
interaction CSS, `make-interfaces-feel-better` for polish, `mobile-native` for
phone behavior, `animate` for the small amount of intentional motion, and
  `wrangler` for Cloudflare commands, and `durable-objects` for multiplayer rooms.
  Keep these skills in `.agents/skills` and run
repoagents checks after changes.
