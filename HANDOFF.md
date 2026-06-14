# Adding a project to diffenderfer.games

Hand this file to another Claude instance (or read it yourself) when integrating
a new project into the [diffenderfer.games](https://github.com/clickermonkey/diffenderfer-games)
catalog host. It explains the `game` block in `package.json`, the build/runtime
contract, and the path-handling fixes apps almost always need.

---

## Your task

Make this project installable into the diffenderfer.games catalog host. The
catalog scans `apps/<slug>/` (real dirs or symlinks to them), reads each
`package.json`, and uses a top-level `game` object to know how to build,
serve, and present the app.

You need to:

1. Add (or fix) the `game` block in this project's `package.json`.
2. Apply the path-handling fixes below so assets resolve under `/<slug>/`.
3. Verify the build still works.

---

## How the catalog mounts apps

Every app is served under `/<slug>/` where `slug` = the `apps/` directory name.
The slug must match `^[a-z0-9][a-z0-9-]*$` (lowercase, URL-safe). Anything else
is skipped silently. The slug is the *folder name in `apps/`*, not the npm
`name` field.

The host strips the `/<slug>` prefix and forwards the rest to the app, so the
app sees requests as if mounted at root — **but** the browser still sees
`/slug/...` in URLs, so any absolute asset path the app emits (`/assets/foo.js`,
`<img src="/sprite.png">`, `fetch('/data.json')`) will hit the wrong place.

---

## The `game` block — two shapes

### Static (build emits a folder, no running process)

```json
"game": {
  "type": "static",
  "title": "My Game",
  "build": "npm run build",
  "serveDir": "dist",
  "image": "cover.png",
  "description": "...",
  "hidden": false
}
```

| field         | required | notes                                                       |
| ------------- | -------- | ----------------------------------------------------------- |
| `type`        | yes      | `"static"`                                                  |
| `title`       | yes      | Shown on the catalog card                                   |
| `serveDir`    | yes      | Folder served at `/<slug>/` (must exist after `build`)      |
| `build`       | no       | Runs once at boot if source changed                         |
| `image`       | no       | Tile image, path relative to project root                   |
| `description` | no       | Falls back to `pkg.description`                             |
| `hidden`      | no       | `true` skips this app from the catalog                      |
| `hub`         | no       | `false` opts out of the shared hub menu/SDK injection       |
| `menuPosition`| no       | Hub menu corner: `top-left` (default)/`top-right`/`bottom-left`/`bottom-right` |
| `leaderboards`| no       | Pre-declared boards `[{ key, title, sort }]` (see the hub)  |
| `pwa`         | no       | `false` opts out of the install/offline (PWA) tags + service worker |
| `controls`    | no       | Gamepad→key map for controller/arcade play (see the hub)    |

### Process (build then run a long-lived server the catalog proxies to)

```json
"game": {
  "type": "process",
  "title": "My Game",
  "build": "npm run build",
  "start": "node dist/server.js --port={{PORT}} --base={{GAME_PATH}}",
  "healthPath": "/",
  "image": "cover.png",
  "description": "...",
  "hidden": false
}
```

| field         | required | notes                                                       |
| ------------- | -------- | ----------------------------------------------------------- |
| `type`        | yes      | `"process"`                                                 |
| `title`       | yes      | Shown on the catalog card                                   |
| `start`       | yes      | Long-lived command; must listen on the assigned port        |
| `build`       | no       | Runs once at boot if source changed                         |
| `healthPath`  | no       | Default `"/"`; must answer with status < 500                |
| `image`       | no       | Tile image, path relative to project root                   |
| `description` | no       | Falls back to `pkg.description`                             |
| `hidden`      | no       | `true` skips this app from the catalog                      |
| `hub`         | no       | `false` opts out of the shared hub menu/SDK injection       |
| `menuPosition`| no       | Hub menu corner (see static table)                          |
| `leaderboards`| no       | Pre-declared boards `[{ key, title, sort }]` (see the hub)  |
| `pwa`         | no       | `false` opts out of the install/offline (PWA) tags + service worker |
| `controls`    | no       | Gamepad→key map for controller/arcade play (see the hub)    |

> **Ports:** the host assigns each process app a free port (via `PORT`/
> `GAME_PORT` and the `{{PORT}}` placeholder) and **probes that it's actually
> free first** — if your assigned port is taken (an orphan, a second host),
> it's skipped and you get another. Just listen on the port you're given.

---

## Placeholders + env vars (work in both `build` and `start`)

String substitution in command strings:

| token           | meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `{{PORT}}`      | Port assigned to this app (process type; static only if you ask for it) |
| `{{GAME_PATH}}` | Public prefix, e.g. `/mygame`                            |
| `{{GAME_SLUG}}` | Slug alone, e.g. `mygame`                                |

Equivalent env vars are also injected into the spawned process:

- `GAME_PORT`, `GAME_PATH`, `GAME_SLUG`
- `PORT` (process-type only)

Prefer env vars over placeholders when your tooling supports them —
placeholders that don't resolve throw a hard error.

---

## Path-handling — THIS IS THE COMMON BUG

Because apps mount under `/<slug>/`, anything that bakes a leading-`/` path
into the build output breaks. Fix at the source:

### 1. Vite projects — add `base: './'` to `vite.config.ts`

```ts
export default defineConfig({
  base: './',
  // ...rest
});
```

This makes `dist/index.html` emit relative `./assets/foo.js` paths that work
at any mount point.

### 2. Code that builds URLs from string literals

Vite/bundlers do **not** rewrite arbitrary string literals. Grep your source
for absolute paths and convert:

```ts
// before
const URL = '/sprites/creatures.png';
// after
const URL = `${import.meta.env.BASE_URL}sprites/creatures.png`;
```

If TypeScript complains about `import.meta.env`, add `"vite/client"` to
`compilerOptions.types` in `tsconfig.json`.

### 3. HTML / `public/` assets

Change `<img src="/foo.png">` to `<img src="foo.png">` (relative).
Public-folder assets live at `${BASE_URL}filename` at runtime.

### 4. `fetch()` / `new URL()`

Switch:

```ts
// before
fetch('/data.json')
// after
fetch(import.meta.env.BASE_URL + 'data.json')
// or, for ESM-relative resolution
new URL('./data.json', import.meta.url)
```

### Non-Vite tools

Same idea — set the build's base/public-path to `./` and audit string
literals:

- webpack: `output.publicPath: './'`
- parcel: `--public-url ./`
- esbuild: `--public-path=./`

---

## Static-app build contract

- `build` runs once at boot from the project root. The catalog caches a hash
  of source files; rebuilds only fire when source changes. Build output
  (anything under `serveDir`, `node_modules`, `dist`, etc.) is excluded from
  the hash, so building doesn't invalidate itself.
- After `build`, `serveDir` must exist or the app is marked broken.
- `serveDir` is served with SPA fallback: missing extensionless paths fall
  back to `index.html`.

---

## Process-app contract

- The app **must** listen on the assigned PORT (passed via `{{PORT}}` and/or
  `process.env.PORT` / `process.env.GAME_PORT`).
- The app **must** respond on `127.0.0.1:PORT{healthPath}` within ~15s of
  spawn or it's marked unhealthy. Any HTTP response with status < 500 counts.
- The catalog proxies HTTP + WebSocket. `X-Forwarded-*` headers are set.
- Crashed apps auto-restart up to 5 times with 2s cooldown, then give up.
- The app sees requests with the `/<slug>` prefix already stripped — code
  internally as if mounted at `/`, but emit asset URLs as if mounted at
  `GAME_PATH` (same `base: './'` rules apply).

---

## Image / tile

`game.image` is a path relative to the project root (NOT to `serveDir`).
It must resolve inside the project. Served separately from the app at
`/_tiles/<slug>` for the catalog page. Missing/broken images are non-fatal —
the card just renders without a thumbnail.

---

## Author + description display

The card shows `pkg.author` (string or `{name, ...}` object — name is
extracted) and `game.description || pkg.description`.

---

## Online features (the hub)

Every app is served from one origin and can tap a shared backend — one user
account across all games, saved game state, per-game stats, leaderboards, and
analytics — with **nothing to set up**. The host injects a style-isolated menu
(login + navigation) into your pages automatically, and exposes a JSON API at
`/_api` plus client assets at `/_hub`.

- **Use it:** `import { hub } from '/_hub/sdk.js'` (plain JS) or vendor the
  fully-typed `clients/hub.ts` into your source (recommended for TS games).
  Then e.g. `hub.putSave('auto', state)`, `hub.submitScore('points', n)`.
- **Leaderboards:** declare them in `game.leaderboards` so they show before the
  first score; submit with `hub.submitScore(key, score)`.
- **No sign-in needed:** the menu auto-creates a *guest* account on load, so
  progress saves immediately; players can later "Create account" (claim) to
  keep it, and logging in from a new device merges the guest's progress in.
- **Offline & installable:** hosted games work offline automatically — a service
  worker caches the app shell/assets and the SDK queues writes locally and syncs
  on reconnect — and are installable to a home screen as a PWA. Nothing to add.
- **Controllers/arcade:** standard gamepads and USB arcade encoders work in every
  game with no code; map keys per game with `game.controls`.
- **Opt out** of hub injection with `"hub": false` or PWA tags with `"pwa": false`;
  **move the menu** with `menuPosition`.

Full contract, endpoint reference, and examples: **`docs/hub.md`**.

---

## Concrete steps

1. Read this project's existing `package.json`, build tooling, and source
   layout.
2. Pick `static` vs `process`:
   - Outputs a folder of files served by the host → **static**.
   - Needs a long-lived server (API, SSR, websockets) → **process**.
3. Add a complete `game` block to `package.json` with type, title,
   build/start commands, and `serveDir` or `healthPath` as appropriate.
4. If this is a Vite (or other bundler) project, set `base: './'` (or
   equivalent).
5. Grep the source for absolute-path string literals referencing assets,
   HTML `src="/..."` / `href="/..."`, and `fetch('/...')` calls — fix each
   to use `import.meta.env.BASE_URL` or relative paths.
6. If TS, add `"vite/client"` to `tsconfig.json` `compilerOptions.types`.
7. Run the build and confirm `dist/index.html` (or equivalent) references
   assets via `./assets/...` not `/assets/...`.
8. If process-type, confirm the server reads `PORT` from env/args and binds
   to it.

Report back: the final `game` block, any vite/tsconfig changes, and any
source-literal path rewrites you made.
