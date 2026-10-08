# dg-template — diffenderfer.games game starter

A ready TypeScript + [Vite](https://vitejs.dev) + [PixiJS v8](https://pixijs.com)
starter for building a game for the **diffenderfer.games** catalog, with the
shared **hub** client (accounts, saves, stats, leaderboards, inventory, and a
unified keyboard/mouse/touch/gamepad input system) vendored in.

## Where games live: the diffenderfer-games organization

Every game is a repo in the GitHub organization
**[diffenderfer-games](https://github.com/diffenderfer-games)** (the host is
[diffenderfer-games/diffenderfer-games](https://github.com/diffenderfer-games/diffenderfer-games)).
To start a new game:

1. **Create the repo in the org from this template**:
   [diffenderfer-games/dg-template](https://github.com/diffenderfer-games/dg-template) →
   **Use this template** → Create a new repository → Owner **diffenderfer-games**,
   name = the game's slug (lowercase `a-z0-9-`), **Private**. Then clone it beside
   the host repo (`git clone https://github.com/diffenderfer-games/<slug>.git`).
   Locally, `tools/New-Game.ps1` makes the folder from this template instead;
   then create an empty private repo in the org and push to it.
2. **Deploy secrets come from the org**: `DEPLOY_SSH_KEY` and `DEPLOY_HOST` are
   organization secrets shared by every private repo, so a new game needs **no**
   repo secrets. Add one only to override (e.g. `DEPLOY_PATH` when the server
   folder isn't the repo name); a repo secret wins over the org one of the same name.
3. **The org's self-hosted Windows runner deploys it automatically**: one runner on
   the owner's machine serves every private repo in the org, so there is nothing to
   register. The variable `CI_ON` switches where the deploy runs: `self` (default,
   also when unset; no Actions minutes) or `github` (GitHub-hosted, costs minutes —
   for when the machine is off).
4. **Link it on the host** (diffenderfer.games): clone it on the droplet and symlink
   it into the host's `apps/<slug>/` — the host's
   [RUNNERS.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/RUNNERS.md)
   "New game checklist" and
   [DEPLOY.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/DEPLOY.md)
   § 12 "Adding a new game". Until then its deploy has nowhere to pull.

**This template repo itself is public** (so it can be used as a template and read
freely). Public repos never get the org's self-hosted runner or its secrets: its
repo variable `CI_ON=github` keeps its own workflow on GitHub-hosted runners (free
for public repos), where the deploy just skips. A game made from it is private and
uses the org runner.

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
package.json          the `game` block the catalog reads (incl. `changes`: the
                      player-facing "What's new" list; add a line per visible change)
src/
  main.ts             starter game — Pixi + hub input + saves + leaderboard + daily
  hub/                vendored hub client (don't edit; `npm run sync-hub` to update)
    hub.ts input.ts overlay.ts legacy.ts daily.ts uistack.ts
    social/rt-types.ts  social/multiplayer wire types (types only)
scripts/sync-hub.mjs  re-copies src/hub/* + the docs below from ../diffenderfer-games
HANDOFF.md            how the catalog builds & mounts a game (read this; synced from the host)
docs/hub.md           full hub API: accounts, saves, leaderboards, input, … (synced from the host)
docs/multiplayer.md   friends, presence, invites, rooms, chat, races (§14) (read if online or racing; synced from the host)
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

Clone this beside the [diffenderfer-games](https://github.com/diffenderfer-games/diffenderfer-games)
host repo and symlink it into `apps/<slug>/` (see the host's `DEPLOY.md`). The
catalog discovers it, runs `npm run build`, and serves `dist/` under `/<slug>/`.

Deploys: `.github/workflows/deploy.yml` deploys on every push to `main`/`master`
once `DEPLOY_SSH_KEY` is available — for a private repo in the
diffenderfer-games org it is, from the org's secrets. By default the deploy runs
on the org's self-hosted Windows runner (no Actions minutes; nothing to register
per repo — see the host's
[RUNNERS.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/RUNNERS.md)).
The variable `CI_ON=github` switches to the GitHub-hosted deploy instead (this
template repo, being public, uses that).
