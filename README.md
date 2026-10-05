# dg-template — diffenderfer.games game starter

A ready TypeScript + [Vite](https://vitejs.dev) + [PixiJS v8](https://pixijs.com)
starter for building a game for the **diffenderfer.games** catalog, with the
shared **hub** client (accounts, saves, stats, leaderboards, inventory, and a
unified keyboard/mouse/touch/gamepad input system) vendored in.

## Quick start

```bash
npm install
npm run dev      # play the starter ("collect the coins")
npm run build    # produces dist/  (what the catalog serves)
```

## What's here

```
index.html            Vite entry
vite.config.ts        base:'./' (required — games mount under /<slug>/)
package.json          the `game` block the catalog reads
src/
  main.ts             starter game — Pixi + hub input + saves + leaderboard + daily
  hub/                vendored hub client (don't edit; `npm run sync-hub` to update)
    hub.ts input.ts overlay.ts legacy.ts daily.ts uistack.ts
    social/rt-types.ts  social/multiplayer wire types (types only)
scripts/sync-hub.mjs  re-copies src/hub/* + the docs below from ../diffenderfer-games
HANDOFF.md            how the catalog builds & mounts a game (read this; synced from the host)
docs/hub.md           full hub API: accounts, saves, leaderboards, input, … (synced from the host)
docs/multiplayer.md   friends, presence, invites, rooms, chat (read if online; synced from the host)
docs/audio.md         music/continuous audio in a background Web Worker (required pattern)
CLAUDE.md             brief for an AI assistant building the game
```

## Building a game

Point a fresh Claude Code instance at this folder and tell it to make a game —
it reads `CLAUDE.md`. Or do it yourself: rewrite `src/main.ts`, set your
`game.title`/`description` in `package.json`, keep `base:'./'`, and use
`import { hub } from './hub/hub'` for online features and input. See `CLAUDE.md`
and `docs/hub.md`. Online games (invites, rooms, chat) follow
`docs/multiplayer.md`.

## Updating the hub client & docs

```bash
npm run sync-hub                     # from ../diffenderfer-games
npm run sync-hub -- ../path/to/host  # or DG_HOST=... npm run sync-hub
```

This copies the host's canonical files:
- `clients/{hub,input,overlay,legacy,daily,uistack}.ts` → `src/hub/`;
- `clients/social/rt-types.ts` → `src/hub/social/`;
- `docs/hub.md`, `docs/multiplayer.md` and `HANDOFF.md` → the same paths here;
- `clients/server/hub-server.mjs` → `server/`, only if the game has a `server/`
  directory (own-server games).

Never hand-edit these copies.

## Hosting

Clone this beside the [diffenderfer-games](https://github.com/clickermonkey/diffenderfer-games)
host repo and symlink it into `apps/<slug>/` (see the host's `DEPLOY.md`). The
catalog discovers it, runs `npm run build`, and serves `dist/` under `/<slug>/`.
