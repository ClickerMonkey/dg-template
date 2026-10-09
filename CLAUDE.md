# Build a diffenderfer.games game

You are building a game for the **diffenderfer.games** catalog. This is a ready
TypeScript + Vite + **PixiJS v8** starter with the shared **hub** client
installed from npm. Your job: turn it into a real game.

## Start here (in order)

1. `npm install`
2. `npm run dev` → open the URL. You'll see the working starter ("collect the
   coins"). Move with WASD / arrows / a gamepad / on-screen stick.
3. Read **`HANDOFF.md`** (how the catalog builds & mounts games — the path rules
   matter) and **`docs/hub.md`** (accounts, saves, stats, leaderboards,
   inventory, and the input system API).
4. Read **`docs/multiplayer.md`** if your game is online (friends, invites,
   rooms, chat). Every game, online or not, still needs its §4 (pause when the hub
   opens). A single-player puzzle can go multiplayer by **racing** (§14): no netcode.
5. Build your game in `src/` (start by rewriting `src/main.ts`).
6. `npm run build` → must produce `dist/` with relative asset paths.

## The rules (don't break these)

- **`base: './'` stays in `vite.config.ts`.** The catalog serves your game under
  `/<slug>/`; absolute asset URLs (`/assets/...`) 404. Use relative paths /
  `import.meta.env.BASE_URL` for any URL you build by hand. (HANDOFF.md § Path-handling.)
- **Edit the `game` block in `package.json`**: set `title`, `description`, and
  optionally `menuPosition`, `leaderboards`, `image` (a `cover.png` for the
  catalog tile), and `controls`. Keep `type: "static"`, `build: "npm run build"`,
  `serveDir: "dist"`, **unless `docs/multiplayer.md` tells you to use
  `own-server`** (a real-time competitive game with its own server is a
  `process` app; see HANDOFF.md).
- **Keep `game.changes` updated** (the player-facing "What's new" list in
  `package.json`, starts empty). Whenever you ship something a player would
  notice, append one short, plain-language line a kid would understand, e.g.
  `"You can now pause with the Escape key."`, not `"Add pause handler"`. Skip
  refactors/build/test work. Use `{ "id", "text" }` if you may reword it later.
  (HANDOFF.md § What's new; docs/hub.md "What's new".)
- **Output to `dist/`** via `npm run build` (Vite). Don't change that contract.
- **The hub client comes from npm, never a vendored copy.** It is the package
  `@diffenderfer-games/hub`, pinned to an exact version in `package.json` (see
  "How the hub client arrives"). Don't add a `src/hub/` copy or a sync script.
- **Don't edit `docs/hub.md`, `docs/multiplayer.md` or `HANDOFF.md`.** They are
  the host's canonical docs; `npm run sync-docs` refreshes them from
  `../diffenderfer-games`.
- **Pause when the hub opens: every game, single-player included.** Call
  `hub.overlay.autoPause({ pause })` once at boot, so opening the hub menu, a chat
  or an invite pauses the game the way your own pause does. Action games show
  their pause screen on close rather than auto-resuming. See
  `docs/multiplayer.md` §4.
- **Online games follow `docs/multiplayer.md`.** Never build your own accounts,
  friends, invites, chat or moderation, and never send player-typed text over your
  own channel. The hub does all of that, kid-safe.
- **Music and other continuous audio go in a background Web Worker.** Never
  synthesize music with live Web Audio node graphs scheduled from the main
  thread: on phones it breaks up whenever frames are heavy. The worker renders
  PCM chunks, and the main thread only queues them as `AudioBufferSourceNode`s
  ~2–3 s ahead. Short one-shot SFX may stay on the main thread. See
  **`docs/audio.md`** for the pattern and a drop-in skeleton.

## Audio (see docs/audio.md)

- **Background music / long loops:** compose and synthesize in a **Web Worker**
  (`new Worker(new URL('./audio/musicWorker.ts', import.meta.url), { type: 'module' })`).
  Stream back fixed-size chunks (transfer the `Float32Array`s, don't copy them), and
  schedule them back-to-back on sample boundaries.
- **Not AudioWorklet.** It needs a secure context, so it fails on `http://` LAN
  test URLs. Workers work everywhere.
- **Keep instant controls on the main thread:** volume, pause/duck and layers
  that must react immediately (render those as a separate stem with its own
  `GainNode`).
- **Unlock and resume** the `AudioContext` on every user gesture, and suspend it
  while the page is hidden.
- **Check on a phone.** Test with a production build over the LAN, and confirm
  there are no gaps while the game is under load.

## Multiplayer (see docs/multiplayer.md)

Every game already gets the hub's friends, presence, DMs and invites with no code.
Read **`docs/multiplayer.md`** when players should play **together** in your game:

- **Choose a transport** (§1):
  - `hub-rooms` keeps the game static, with no server: the host player's browser
    runs the rules and the hub relays.
  - `own-server` is a process app with its own netcode; players are verified with
    `hub.mp.ticket()` + `server/hub-server.mjs`.
- **Declare `game.multiplayer`** in `package.json` (§2): `lobby`, `players`,
  `transport`, `invites`/`join`/`spectate`, `modes`, `quickChat`, `chatAllow`.
- **At boot** (§6): `hub.overlay.autoPause(...)` and `hub.mp.onLaunch(cb)` (within 8 s;
  kinds `host`/`guest`/`join`/`watch`), plus `hub.mp.onJoinInfo(cb)`. The lobby URL
  opens your lobby.
- **During play:**
  - `hub.presence.set({...})` at screen changes;
  - `hub.mp.setBusy(true)` during a live match (leave guard, no pausing);
  - `hub.notify.setQuiet(true)` during intense play.
- **Lobby:** an **Invite** button (`hub.social.openInvite()`) and a 🔔
  (`hub.social.openNotify({ game })`). Every player name opens
  `hub.social.openPlayer({ userId })`.
- **Chat** goes only through `room.chat` / `room.quick` (or your server's
  `hub.chat()`):
  - render only delivered text;
  - keep the draft and show `err.hint` on a `ContentRejectedError`;
  - quick-chat chips when `chatMode` is `quick`; hide chat when it's `off`.
- **No violent words in UI copy** ("zap", not "shoot").
- **Testing is required** (§12): a `tests/hub/` suite covering the 8 hub scenarios
  (invite → jump → accept → lobby, decline/expire, leave guard, join/watch, pause
  on hub open, chat reject/soften/quick-only/off, reconnect, suspended), using the
  hub's test kit (`startHost` + `mpdemo`).

## How the hub client arrives

The hub client is the npm package **`@diffenderfer-games/hub`** (it pulls in
`@diffenderfer-games/hub-contract`). Its types and TSDoc come with it.

- **Update:** `npm install --save-exact @diffenderfer-games/hub@<version>`, then
  `npm run build`. While it is on `2.0.0-next.N` prereleases, keep the exact pin.
- **Check:** `npm run hub-doctor`. It fails if the installed client is outside the
  live hub's supported range or the `game.*` block is invalid, and warns about a
  leftover vendored copy. Run it before pushing.
- **Entry points:** `@diffenderfer-games/hub` (everything most games use), plus
  `/input`, `/daily`, `/race`, `/social`, `/mp`, `/rooms` and `/types`.
- **Own-server games** keep `server/hub-server.mjs` (the game-server SDK, not on
  npm): `npm run sync-hub-server` copies it from the sibling host checkout.
- **Hub tests** (`tests/hub/`) use the host checkout's test kit (`DG_HOST`,
  default `../diffenderfer-games`); run them with `HUB_IMPL=next`, the hub
  production runs.

## Using the hub (all optional, all free — no backend to run)

Import once: `import { hub } from '@diffenderfer-games/hub';`

- **Accounts** are handled by the injected menu (guest auto-created; players can
  claim/login). You usually just read `await hub.me()`.
- **Saves** (per player, per game): `hub.putSave('main', state)` /
  `await hub.getSave('main')`. Offline-safe — writes queue and sync on reconnect.
- **Stats**: `hub.incrStat('kills', 1)`, `hub.maxStat('combo', n)`.
- **Leaderboards**: declare in `package.json` `game.leaderboards`, submit with
  `hub.submitScore('high', score, { title: 'High Score' })`.
- **Inventory/trades**: see docs/hub.md if your game has items/currency.
- **Pause on hub UI**: `hub.overlay.autoPause({ pause: () => pauseGame() })`
  (required, see the rules above).
- **Friends, invites, rooms, chat**: see the Multiplayer section and
  `docs/multiplayer.md`.
- **Races** (single-player → multiplayer): declare `game.race` (params, stats,
  `minMs`), call `hub.race.define({ start, end, exit })` at boot and build the
  puzzle from `start(r)`'s `r.seed` + `r.params` only (seeded PRNG), add a **Race**
  button on the main menu → `hub.race.create({ params })` (+ `hub.race.browse()`,
  `hub.race.openHistory()`), and report `hub.race.status(stats, progress)` then
  `finish(stats)` / `lose(stats)`. The hub does the lobby, invites, countdown,
  live HUD, referee, result card and race history. See `docs/multiplayer.md` §14.
- **Input** — the big one. Declare named inputs and read them uniformly on
  keyboard / mouse / touch / gamepad; the hub draws touch controls and handles
  gamepad + menu navigation. See `src/main.ts` for a full example and the
  "Input system" section of `docs/hub.md`. Pattern:

  ```ts
  hub.input.define({ groups: { play: { inputs: {/* ... */}, axes: {/* ... */}, virtual: [/* ... */] } } });
  hub.input.enable('play');
  // each frame:
  const move = hub.input.vector('move');   // { x, y, mag }
  if (hub.input.down('jump')) jump();
  ```

## Rendering

Use **PixiJS v8** for gameplay (the starter shows the v8 API: `Application`,
`Graphics`, `Text`, `app.ticker`). HTML overlays are fine for menus/HUD if you
prefer — the hub's input/menu overlays work over both.

When hosted, the hub also makes your game **installable + offline** (service
worker + manifest) automatically; nothing to add.

## Definition of done

- `npm run build` succeeds; `dist/index.html` references `./assets/...` (relative).
- The game plays with keyboard, and (if it's an action game) with a gamepad and
  on a touch screen via the on-screen controls.
- `package.json` `game.title`/`description` describe your game; a `cover.png` +
  `game.image` is a nice touch.
- `game.changes` has a line for each player-visible change you shipped (once the
  game is live; a brand-new game can leave it empty).
- Progress saves via `hub.putSave` and (if competitive) a leaderboard is wired.
- If the game has music, it's rendered in a background worker (docs/audio.md)
  and plays without gaps on a phone.
- Opening the hub menu pauses the game (`hub.overlay.autoPause`); closing it shows
  the pause screen (or resumes, for turn-based/idle games).
- **Online games:** `game.multiplayer` is declared, every item of the
  `docs/multiplayer.md` checklist is ticked, and the `tests/hub/` suite passes the
  required hub test scenarios.

To install into the catalog later: clone next to the host repo and symlink it
into the host's `apps/<slug>/` (see HANDOFF.md / the host's DEPLOY.md).

## Where the repo lives

Games are private repos in the GitHub organization **diffenderfer-games**
(`https://github.com/diffenderfer-games/<slug>`), created from this template
(README "Where games live"). Pushing to `main`/`master` deploys: the repo's own
deploy secrets (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`, added when the repo is created)
and the org's self-hosted runner run the deploy, so don't add runners or
workflow changes for that. The template repo
itself is public and runs on GitHub-hosted runners (`CI_ON=github`).
