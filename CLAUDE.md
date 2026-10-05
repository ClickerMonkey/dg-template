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
4. Build your game in `src/` (start by rewriting `src/main.ts`).
5. `npm run build` → must produce `dist/` with relative asset paths.

## The rules (don't break these)

- **`base: './'` stays in `vite.config.ts`.** The catalog serves your game under
  `/<slug>/`; absolute asset URLs (`/assets/...`) 404. Use relative paths /
  `import.meta.env.BASE_URL` for any URL you build by hand. (HANDOFF.md § Path-handling.)
- **Edit the `game` block in `package.json`**: set `title`, `description`, and
  optionally `menuPosition`, `leaderboards`, `image` (a `cover.png` for the
  catalog tile), and `controls`. Keep `type: "static"`, `build: "npm run build"`,
  `serveDir: "dist"`.
- **Output to `dist/`** via `npm run build` (Vite). Don't change that contract.
- **Don't edit `src/hub/*`.** That's the vendored hub client
  (`hub.ts` + `input.ts` + `overlay.ts` + `legacy.ts`), a snapshot of the host's
  canonical client. Import from it; to update it, re-copy from the host repo's
  `clients/`.
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

To install into the catalog later: clone next to the host repo and symlink it
into the host's `apps/<slug>/` (see HANDOFF.md / the host's DEPLOY.md).
