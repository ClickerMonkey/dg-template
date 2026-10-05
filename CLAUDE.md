# Build a diffenderfer.games game

You are building a game for the **diffenderfer.games** catalog. This is a ready
TypeScript + Vite + **PixiJS v8** starter with the shared **hub** client already
vendored. Your job: turn it into a real game.

## Start here (in order)

1. `npm install`
2. `npm run dev` → open the URL. You'll see the working starter ("collect the
   coins"). Move with WASD / arrows / a gamepad / on-screen stick.
3. Read **`HANDOFF.md`** (how the catalog builds & mounts games — the path rules
   matter) and **`docs/hub.md`** (accounts, saves, stats, leaderboards,
   inventory, and the input system API).
4. Read **`docs/multiplayer.md`** if your game is online (friends, invites,
   rooms, chat). Every game, online or not, still needs its §4 (pause when the hub
   opens).
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
- **Output to `dist/`** via `npm run build` (Vite). Don't change that contract.
- **Don't edit `src/hub/*`.** That's the vendored hub client
  (`hub.ts`, `input.ts`, `overlay.ts`, `legacy.ts`, `daily.ts`, `uistack.ts` and
  `social/rt-types.ts`), a snapshot of the host's canonical client. Import from it.
  To update it, run `npm run sync-hub` (it copies from `../diffenderfer-games`).
  The same sync also refreshes **`docs/hub.md`, `docs/multiplayer.md` and
  `HANDOFF.md`**. Those are the host's canonical docs, so don't edit them here either.
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

## Using the hub (all optional, all free — no backend to run)

Import once: `import { hub } from './hub/hub';`

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
