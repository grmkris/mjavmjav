# mjavmjav.com

A tiny, intentionally unserious cat soundboard: tap the cat, deploy four noises,
and let the beast have the aux. The page is plain HTML/CSS/JS with a small SVG
mascot and a Cloudflare Worker serving static assets.

## Run it

```sh
bun install
bun run check
bun run dev
bun run deploy
```

The custom domains are configured in `wrangler.jsonc`. The first `mjav` includes
`public/meow.wav`, a 131 KB CC0 recording from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav).
The other sounds are synthesized in the browser with the Web Audio API, so there
are no runtime audio services or tracking dependencies.

## Agent setup

The repo carries the standard `AGENTS.md`, `.mcp.json`, generated harness config,
and the relevant vendored skills for visual design, CSS, motion, mobile behavior,
and Wrangler. Run `bunx repoagents@1 check` after changing agent configuration.
