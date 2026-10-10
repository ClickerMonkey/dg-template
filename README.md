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
2. **Add the deploy secrets to the repo** (Settings → Secrets and variables →
   Actions, or `gh`):
   `gh secret set DEPLOY_SSH_KEY -R diffenderfer-games/<slug> < ~/.ssh/diffenderfer_deploy`
   and `gh secret set DEPLOY_HOST -R diffenderfer-games/<slug> -b diffenderfer.games`
   (`DEPLOY_HOST` defaults to `diffenderfer.games` if unset). Add `DEPLOY_PATH` only
   when the server folder isn't the repo name. Each repo has its own copies: org
   secrets would need a paid plan for private repos.
3. **The org's self-hosted Windows runner deploys it automatically**: one runner on
   the owner's machine serves every private repo in the org, so there is nothing to
   register. The deploy runs only there (GitHub-hosted runners aren't used), and only
   for a push to the default branch or a manual run.
4. **Push to `main`/`master`: the first deploy puts it on the host.** When the
   droplet has no clone yet, the deploy clones the repo into `/root/<repo>`
   (the droplet's `gh` login reads private org repos), runs `npm install`,
   links it as `/root/diffenderfer-games/apps/<slug>` (slug = the repo name,
   lowercased; set the repo variable `DEPLOY_SLUG` to override) and restarts the
   catalog. Later pushes just pull, install and restart. Check
   https://diffenderfer.games/<slug>/. (The manual way still works: the host's
   [RUNNERS.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/RUNNERS.md)
   "New game checklist" and
   [DEPLOY.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/DEPLOY.md)
   § 12 "Adding a new game".)

**This template repo itself is public** (so it can be used as a template and read
freely). Public repos never get the org's self-hosted runner, and it has no deploy secrets: its
deploy job is guarded off (`if: github.repository != 'diffenderfer-games/dg-template'`),
so it runs on no runner at all. A game made from it is private and uses the org runner.

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
scripts/sync-docs.mjs re-copies the three docs below from ../diffenderfer-games
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
`import { hub } from '@diffenderfer-games/hub'` for online features and input. See `CLAUDE.md`
and `docs/hub.md`. Online games (invites, rooms, chat) follow
`docs/multiplayer.md`.

## Updating the hub client

The hub client is the npm package
[`@diffenderfer-games/hub`](https://www.npmjs.com/package/@diffenderfer-games/hub),
pinned to an exact version in `package.json` (a `2.0.0-next.N` prerelease for
now). Never copy its sources into the game.

```bash
npm install --save-exact @diffenderfer-games/hub@<version>   # then npm run build
npm run hub-doctor   # supported by the live hub, game.* is valid, no vendored copy
```

## Updating the docs and the game-server SDK

```bash
npm run sync-docs                      # from ../diffenderfer-games
npm run sync-docs -- ../path/to/host   # or DG_HOST=... npm run sync-docs
```

This copies `docs/hub.md`, `docs/multiplayer.md` and `HANDOFF.md` from the
host. Never hand-edit these copies.

Own-server games (with a `server/` folder) keep a copy of the game-server SDK
in `server/hub-server.mjs`. It is not on npm: `npm run sync-hub-server` copies
the build from the sibling host checkout (`../diffenderfer-games`, after
`npm ci` in its `next/`). Then run the game's tests and commit just that file.

## Hosting

Clone this beside the [diffenderfer-games](https://github.com/diffenderfer-games/diffenderfer-games)
host repo and symlink it into `apps/<slug>/` (see the host's `DEPLOY.md`). The
catalog discovers it, runs `npm run build`, and serves `dist/` under `/<slug>/`.

Deploys: `.github/workflows/deploy.yml` deploys on every push to `main`/`master`
once the repo secret `DEPLOY_SSH_KEY` is set ("Where games live", step 2). By default the deploy runs
on the org's self-hosted Windows runner (no Actions minutes; nothing to register
per repo — see the host's
[RUNNERS.md](https://github.com/diffenderfer-games/diffenderfer-games/blob/master/RUNNERS.md)).
It runs only for a push to the default branch or a manual run (never for pull
requests); in this template repo itself it never runs.
