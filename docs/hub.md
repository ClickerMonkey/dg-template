# The Hub — shared online features for diffenderfer.games

Every game hosted in this catalog can tap into a shared backend for free:
one user account across all games, saved game state, per-game stats,
leaderboards, and analytics — plus an injected menu (top-left) that handles
sign-in and navigation for you.

You do **not** need to run your own server, database, or auth to use any of
this. It is all served from the host at the same origin your game runs on.

---

## TL;DR

```html
<script type="module">
  import { hub } from '/_hub/sdk.js';

  // Who's signed in? (null if not — the menu handles login.)
  const { user } = await hub.me();

  // Save / load game state (per user, per game, named slots).
  await hub.putSave('auto', { level: 7, gold: 120 });
  const { save } = await hub.getSave('auto');

  // Submit a score — the board is created on first use.
  await hub.submitScore('highscore', 9001, { title: 'High Score' });
  const { entries } = await hub.getLeaderboard('highscore');
</script>
```

That's it. When your game is hosted under `/<your-slug>/`, the SDK figures out
the rest.

---

## How it reaches the API

All games are served from one origin (e.g. `https://diffenderfer.games`), each
under its own path prefix `/<slug>/`. The hub API lives at **`/_api`** on that
same origin, so:

- You can call it with a plain root-relative path: `fetch('/_api/me')`.
- The login cookie is sent automatically (same-origin) — one login works
  across every game.
- There is no CORS to configure and no API host to hard-code.

The SDK derives its base URL as `new URL('/_api', location.origin)` and your
game's **slug** from the first path segment (or from the injected
`window.__HUB__` config). If you ever need to override, see
[Advanced](#advanced).

---

## The injected menu

The host injects a small bootstrap into your game's HTML automatically:

```html
<script>window.__HUB__={"slug":"your-slug","apiBase":"/_api","menu":"top-left"};</script>
<!-- install/offline tags: web-app manifest, favicon, theme-color, apple-* meta,
     and a service-worker registration (see "Offline & installable" below) -->
<script type="module" src="/_hub/menu.js" defer></script>
```

`menu.js` renders a self-contained, style-isolated (Shadow DOM) menu button.
Opening it gives the player: a **connection status** row (with a "Sync now"
button when offline changes are queued), a **Fullscreen** toggle (when the
browser supports it), a link home, login / signup / logout, their stats for
your game, this game's leaderboards, and a list to jump to other games. It also
records a `play` event on load and periodic `heartbeat`s while the tab is
visible (this drives the analytics numbers), and loads a **gamepad adapter** so
controllers work everywhere (see [Controller & arcade support](#controller--arcade-support)).

Because it's in a Shadow DOM with `all: initial`, it won't collide with your
game's CSS, and your CSS won't leak into it.

### Where the menu sits

By default the button is top-left. If that overlaps your own UI, pick another
corner with `game.menuPosition` — `"top-left"` (default), `"top-right"`,
`"bottom-left"`, or `"bottom-right"`:

```json
"game": { "type": "static", "title": "My Game", "serveDir": "dist", "menuPosition": "top-right" }
```

The drawer slides in from whichever side (left/right) the button is on.

### Opting out

Add `"hub": false` to the `game` block in your `package.json` and the host
will not inject anything into your pages:

```json
"game": { "type": "static", "title": "My Game", "serveDir": "dist", "hub": false }
```

You can still use the SDK manually by importing `/_hub/sdk.js` yourself.

---

## The SDK (`/_hub/sdk.js`)

An ES module. Import it (`import { hub } from '/_hub/sdk.js'`) or load it with a
`<script type="module">` and use `window.HubSDK.hub`. Every method returns a
promise.

| Method | Description |
| --- | --- |
| `hub.me()` | `{ user, profiles }` — current user or `user: null`. |
| `hub.signup(username, password)` | Create an account and sign in. |
| `hub.login(username, password)` | Sign in. |
| `hub.logout()` | Sign out. |
| `hub.getProfile()` | This game's profile for the current user. |
| `hub.setProfile({ displayName?, data? })` | Update it (`data` is arbitrary JSON). |
| `hub.listSaves()` | Slot metadata (no payloads). |
| `hub.getSave(slot)` | `{ save }` — one slot's data, or `save: null`. |
| `hub.putSave(slot, data, label?)` | Create/overwrite a save slot. |
| `hub.deleteSave(slot)` | Delete a slot. |
| `hub.getStats(userId?)` | Stats map; omit `userId` for your own. |
| `hub.setStat(key, value)` | Set a numeric stat. |
| `hub.incrStat(key, amount=1)` | Add to a stat. |
| `hub.maxStat(key, value)` | Keep the larger of old/new. |
| `hub.submitScore(boardKey, score, { title?, sort?, meta? })` | Submit a score. |
| `hub.getLeaderboard(boardKey, limit=50)` | A board's ranked entries. |
| `hub.listLeaderboards()` | This game's boards. |
| `hub.allLeaderboards()` | Every game's boards (catalog-wide). |
| `hub.recordPlay()` / `hub.heartbeat()` / `hub.event(type)` | Analytics events. |
| `hub.listGames()` | The catalog, for navigation. |
| `hub.getInventory()` / `hub.grant(bundle)` | Inventory snapshot / add goods (offline-capable). |
| `hub.prefetchAll()` | Warm the local cache for **every** game in one request. |
| `hub.sync()` | Flush the offline queue to the server now. |
| `hub.pending()` | Count of queued mutations + buffered events awaiting sync. |
| `hub.online` / `hub.isOffline` | Current connection state. |
| `hub.onStatus(cb)` | Subscribe to status changes; returns an unsubscribe fn. |

**Offline-first (this is automatic — no config):** the SDK keeps a local mirror
of your game's state in `localStorage`, warmed by every successful read. When
the network drops, **reads serve from that cache** and **writes apply
optimistically *and* enqueue a durable op**. On reconnect the queue replays in
order and merges into the server (saves take the latest, `incr` adds on top of
the server value, `max`/scores keep the best, grants sum). Connection state is
detected both ways (`navigator.onLine` + request outcomes), so it recovers on
its own. See [Offline & installable](#offline--installable-pwa) for the full
picture, the merge rules, and the window events (`hub:online`, `hub:offline`,
`hub:sync`, `hub:status`).

A few operations genuinely need the server and **reject when offline** rather
than fake it: `login` / `signup` / `claim` / `logout`, the `exchange` / `sell` /
`buy` economy swaps, and all `*Trade` calls. (`ensureGuest` falls back to a
local guest so play continues.)

---

## TypeScript client (recommended for TS games)

For typed games, vendor [`clients/hub.ts`](../clients/hub.ts) into your source
(e.g. copy it to `src/hub.ts`). It's a self-contained, dependency-free class
with full types for every endpoint — no `window.HubSDK`, no ambient globals.

```ts
import { hub } from './hub';            // auto-detects slug + API base
// or: import { Hub } from './hub'; const hub = new Hub({ slug, apiBase });

const { user } = await hub.me();        // user: User | null

interface SaveData { level: number; gold: number }
await hub.putSave<SaveData>('auto', { level: 7, gold: 120 }, 'Slot A');
const { save } = await hub.getSave<SaveData>('auto');
save?.data.level;                       // typed as number

await hub.submitScore('highscore', 9001, { title: 'High Score', sort: 'desc' });
const { entries } = await hub.getLeaderboard('highscore'); // LeaderboardEntry[]
```

Differences from the plain JS SDK:

- **Throws `HubError` on failure** (instead of returning `null`). `HubError`
  carries `.status` — the HTTP code (`401` not signed in, `404` unknown
  game/board, `413` too large), or `undefined` for a transport/offline error
  (also exposed as `.isOffline`). Wrap calls in try/catch:

  ```ts
  import { HubError } from './hub';
  try {
    await hub.submitScore('highscore', score, { title: 'High Score' });
  } catch (e) {
    if (e instanceof HubError && e.status === 401) showLoginPrompt();
    else if (e instanceof HubError && e.isOffline) {/* running standalone */}
  }
  ```

- **Generics** on `getSave<T>`, `putSave<T>`, `getProfile<T>`, `setProfile<T>`
  type your save/profile payloads.
- **Analytics helpers** (`recordPlay`, `heartbeat`, `event`) are
  fire-and-forget — they never throw.
- All response types (`User`, `Save<T>`, `Board`, `LeaderboardEntry`,
  `Metrics`, …) are exported for your own signatures.

The injected menu still provides the login UI and fires play/heartbeat, so even
a game that only reads via this client gets sign-in for free.

### Offline mode (and developing without the hub running)

The TS client mirrors the injected SDK: a `localStorage`-backed cache, a durable
mutation queue, two-way connection detection, and `prefetchAll()` — so it works
both as a dev convenience (build with no backend) and as real offline support in
production. Controlled by the `offline` option:

- `'auto'` (default) — try the network; on a **connection failure** fall back to
  local storage *and* queue writes. Real API errors (4xx) still throw. It
  **recovers automatically**: when a later request succeeds (or the browser
  fires `online`), the queue flushes and the cache re-warms.
- `'always'` — never touch the network; pure local. Ideal for `vite dev` with
  no host.
- `'never'` — strict; always hit the network, throw if it's down (no queue).

```ts
import { Hub } from './hub';
// e.g. in dev, force local; in prod, let it auto-detect:
const hub = new Hub({ offline: import.meta.env.DEV ? 'always' : 'auto' });
```

Offline, **writes apply to the cache and enqueue**, replaying/merging on
reconnect (saves take the latest, `incr` sums, `max`/scores keep the best);
stats, saves, profile and leaderboard bests persist locally. Extra surface,
matching the injected SDK: `hub.pending()`, `hub.sync()`, `hub.onStatus(cb)`,
`hub.prefetchAll()`, `hub.isOnline`, and the `hub:online` / `hub:offline` /
`hub:sync` / `hub:status` window events. `OfflineError` (a `HubError` subclass)
is exported for online-only paths.

In `'always'`/dev mode `login`/`signup` still record a local dev user so
logged-in flows work; analytics buffer and cross-game listings stay safe.
Nothing throws merely for being offline (except the strictly online-only ops),
so your game code is identical whether or not the hub is up.

---

## Offline & installable (PWA)

Every hub-enabled game (and the catalog) is a installable, offline-capable PWA
with **nothing to add to your game**. Two layers cooperate:

**1. App shell (service worker).** The host serves one shared service worker at
`/_hub/sw.js` and registers it per scope (each game at `/<slug>/`, the catalog
at `/`). It runtime-caches your HTML, JS, CSS, images, audio, fonts, and
allow-listed CDNs (jsDelivr, Google Fonts, unpkg, cdnjs) as they load, so after
one online visit the game **loads and plays with no connection**. Strategy:
network-first for navigations (falls back to the cached shell), stale-while-
revalidate for same-origin assets, cache-first for CDNs. `/_api/*` is never
cached — offline data is the SDK's job (above).

**2. Install ("add to home screen").** A per-game web manifest, icons (your
cover image + the DG logo), and the iOS/Android install meta are injected for
you, so players can install the game (or the whole catalog) as a standalone app.
On desktop Chrome/Edge it's the address-bar install button; on iOS/Android it's
"Add to Home Screen"; Safari macOS uses "Add to Dock".

**Data offline (the SDK).** Covered above — local cache + durable queue +
merge-on-reconnect. Listen for status if you want to surface it yourself:

```js
window.addEventListener('hub:offline', () => showBadge('offline'));
window.addEventListener('hub:online',  () => showBadge('online'));
window.addEventListener('hub:sync', (e) => {
  // e.detail: { pending, flushed, conflicts }
});
hub.prefetchAll(); // optionally warm the cache for all games up front
```

**Opt out / tune.** Add `"pwa": false` to your `game` block to skip the
manifest/SW/install tags for one app, or set `HUB_PWA=0` to disable the whole
layer. Service-worker behaviour is controlled by env vars on the host:
`HUB_SW_VERSION` (bump to invalidate all SW caches on deploy), `HUB_SW_MAX_ENTRIES`,
and `HUB_SW_CACHEABLE_HOSTS` (the cross-origin allowlist). See `src/config.js`.

> **Secure context:** service workers, install, and the Gamepad API only work
> over **HTTPS or `localhost`**. In production that's the Caddy TLS front
> (`diffenderfer.games`); for a local kiosk, point the browser at
> `http://localhost:<port>`, not a LAN IP.

---

## Controller & arcade support

A controller adapter is injected with the menu, so **standard gamepads and
arcade sticks work in every game with no code**. Arcade controls reach it the
usual way: wire buttons/sticks to a USB encoder, which the browser exposes as a
gamepad via the Web Gamepad API. The adapter reads direction from **both** the
analog stick and the d-pad, so it works whichever way your encoder reports it.

It runs in three contexts automatically:

- **In a game** — translates the pad into synthesized keyboard events (with
  `key`, `code`, and legacy `keyCode` all set). Holding a direction holds the key.
- **On the catalog** — moves a highlight across the tiles and opens the focused
  game.
- **In the hub menu** — the **Select/Back button (8)** pops the menu from
  anywhere; while open, the stick navigates its items, A activates, B closes.
  So the whole arcade is playable with no keyboard.

### Mapping controls per game

The default is arrows to move and the face buttons to the usual action keys
(A→Space, B→Enter, X→Z, Y→X, Start→Enter, Select→Esc). Override per game with a
`controls` block in `package.json`; values are
[`KeyboardEvent.code`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code/code_values)
strings, and `buttons` keys are Standard-Gamepad button indices:

```json
"game": {
  "type": "static", "title": "My Game", "serveDir": "dist",
  "controls": {
    "up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD",
    "buttons": { "0": "Space", "1": "ShiftLeft", "9": "Enter" }
  }
}
```

For **two players**, give a `players` array — pad 0 uses `players[0]`, pad 1 uses
`players[1]`, and so on:

```json
"controls": {
  "players": [
    { "left": "KeyA", "right": "KeyD", "up": "KeyW", "down": "KeyS", "buttons": { "0": "Space" } },
    { "left": "ArrowLeft", "right": "ArrowRight", "up": "ArrowUp", "down": "ArrowDown", "buttons": { "0": "Enter" } }
  ]
}
```

> Synthesized key events are how the adapter stays game-agnostic — it works as
> long as your game reads keyboard input. The same secure-context rule applies:
> the Gamepad API needs HTTPS or `localhost`.

The above is the **zero-config** layer. For first-class input, opt into the
input system below.

---

## Input system (`hub.input`)

A unified input layer: declare **named inputs** that each read as a scalar
`0..1`, map them to keyboard / mouse / touch / gamepad, and read them the same
way on every device. The hub handles device detection, mouse↔gamepad
arbitration, virtual on-screen controls for touch, gamepad/menu navigation, an
on-screen keyboard, and player remapping that persists. It's renderer-agnostic
(works for fully-Pixi and HTML+Pixi games) because all hub-drawn UI is a DOM
overlay. Available via the canonical client at `/_hub/hub.js` (or `hub.input`
from the vendored `clients/hub.ts`).

### Declare and read

```ts
import { hub } from '/_hub/hub.js';   // or the vendored clients/hub.ts

hub.input.define({
  groups: {
    play: {
      inputs: {
        moveLeft:  { keys:['a','ArrowLeft'],  gamepad:{ axis:[0,'-'] }, touch:{ stick:'move', axis:'x-' } },
        moveRight: { keys:['d','ArrowRight'], gamepad:{ axis:[0,'+'] }, touch:{ stick:'move', axis:'x+' } },
        jump:      { keys:[' '], gamepad:{ button:0 }, touch:{ button:'jump' } },
        shoot:     { mouse:{ button:0 }, gamepad:{ button:7 }, touch:{ button:'fire' } },
        pause:     { keys:['Escape','p'], gamepad:{ button:9 } },
      },
      axes: { move: { x:['moveLeft','moveRight'] } },
      virtual: [
        { id:'move', type:'joystick', place:'bottom-left' },
        { id:'jump', type:'button', place:'bottom-right', label:'A' },
        { id:'fire', type:'button', place:'bottom-right', label:'B' },
      ],
    },
  },
});
hub.input.enable('play');

// in your game loop:
if (hub.input.down('jump')) jump();          // edge: true the frame it crosses ≥0.5
const move = hub.input.vector('move');        // { x, y, mag }  (mag 0..1)
const firing = hub.input.value('shoot') >= 0.5;
```

Each input exposes `value`/`raw` (`0..1`), `isDown`, `isUp` (frame-based edges).
`hub.input.axis(name)` returns `-1..1`; `hub.input.vector(name)` returns
`{x,y,mag}` with `mag ≤ 1`.

### Groups, devices, arbitration

- **Groups** are enabled/disabled (`hub.input.enable('play')` /
  `disable('pause')`) — enable gameplay during play, a menu group while paused.
  A disabled group's inputs read 0 and its virtual controls hide.
- **Touch devices** show the declared **virtual controls** (joysticks, buttons,
  d-pads, tap regions). Every control is fully game-styled: `place` (anchor),
  `size` (or `width`/`height` for non-square), `shape`
  (`circle`/`round`/`square`/`pill`), `color` (border/knob/pressed), `bg`,
  `text`, `opacity`, and `label`/`html`. Buttons cluster *beside* a joystick
  sharing the same corner (no overlap), and players can drag-reposition + the
  layout persists. Controls hide when a gamepad is active (toggle in the menu's
  **Controls**).
- Keyboard always works; **mouse and gamepad are last-used-wins** (using the
  gamepad ignores the mouse until the mouse moves again). Subscribe with
  `hub.input.on('sourcechange', s => …)`.

### Navigable groups (menu navigation)

Mark a group `navigable` to let the gamepad/keys traverse and activate UI —
real HTML elements (auto bounds + click/focus) or registered Pixi elements
(`getBounds()` + `onAct`). It highlights the active element, emits
`focus`/`blur`/`act`, re-queries elements after each interaction, and opens the
**on-screen keyboard** for text fields.

```ts
groups: { menu: {
  navigable: { next:'navNext', prev:'navPrev', up:'navUp', down:'navDown', act:'navAct',
    elements: () => Array.from(document.querySelectorAll('#pause [data-nav]')) },
  inputs: { navNext:{...}, navPrev:{...}, navAct:{ keys:['Enter'], gamepad:{ button:0 } }, ... },
}}
```

### Remapping & persistence

Players open **Controls** in the hub menu to rebind any input (capture the next
key/gamepad button) and customize virtual controls (show/hide, drag to
reposition). Overrides save to `localStorage` (offline-safe) and sync to the
cloud for signed-in players (reserved `__controls` save). They're merged over
the game's defaults at init — your `define()` stays the source of truth.

> The canonical client `clients/hub.ts` is bundled to `/_hub/hub.js` by esbuild
> on demand (cached); `/_hub/sdk.js` is a back-compat shim re-exporting it.

---

## Leaderboards

A game can have **many** leaderboards, each identified by a `boardKey`. A board
stores **one best entry per user**. The first score submitted to a new key
creates the board, setting its title and sort direction; later submissions
can't rename it.

### Declaring boards up front (recommended)

So your boards show on the catalog *before* anyone has scored, declare them in
your `package.json` `game.leaderboards`. The host pre-creates them on boot
(idempotent — safe to leave). Each entry is `{ key, title, sort }` (`sort` is
`"desc"` by default, `"asc"` for "lower is better" like times):

```json
"game": {
  "type": "static", "title": "Geometry Dungeon", "serveDir": "dist",
  "leaderboards": [
    { "key": "arcade-points", "title": "Arcade — Points", "sort": "desc" },
    { "key": "any%-time",     "title": "Any% Time",       "sort": "asc"  }
  ]
}
```

Declaring is optional — `submitScore` still auto-creates a board on first use —
but a declared board has its title/sort fixed by you, and appears empty
("No entries yet") until the first score. Your game still decides *when* to
submit (e.g. iansaur submits `time`/`creatures` once three levels are cleared).

```js
// Higher is better (default):
await hub.submitScore('arcade-high', 50000, { title: 'Arcade High Score' });

// Lower is better (e.g. speedruns) — set sort once, on first submit:
await hub.submitScore('any%-time', 92.4, { title: 'Any% Time', sort: 'asc' });

// Attach arbitrary context to an entry:
await hub.submitScore('max-level', 12, { title: 'Max Level', meta: { class: 'mage' } });
```

`submitScore` returns `{ board, best, rank }`. Only an *improvement* (per the
board's sort direction) replaces the user's existing entry. Reading:

```js
const { board, entries } = await hub.getLeaderboard('arcade-high', 10);
// entries: [{ rank, userId, username, score, meta }, ...]
```

The root catalog page shows the top entries of every board across all games.

---

## Saves and stats

- **Saves** are per user, per game, in named **slots** (`'auto'`, `'slot1'`,
  whatever you like — `[A-Za-z0-9_.:-]`, ≤64 chars). `data` is any JSON up to
  64 KB. Use multiple slots for multiple save files.
- **Stats** are per user, per game numeric values under string keys, with
  `set` / `incr` / `max` update modes. They're readable by anyone (for profile
  pages), so don't store secrets in them.

```js
await hub.incrStat('games_played', 1);
await hub.maxStat('best_combo', combo);
const { stats } = await hub.getStats(); // { games_played: 9, best_combo: 27 }
```

### Cloud-syncing a game that already has a localStorage save

If your game already persists to `localStorage`, keep that as the local layer
and use a single save slot (`'main'`) as the cloud mirror. The pattern the
bundled games use:

- **Push on save** — whenever you write localStorage, also `hub.putSave('main', state)`
  (debounced, fire-and-forget). It's a no-op unless signed in.
- **Pull at boot** — before reading your local save, `await hub.getSave('main')`;
  adopt the cloud copy only when it represents *more* progress (compare a
  monotonic metric like total points), otherwise push your local up to seed it.
  This avoids clobbering local progress.
- **Login mid-session** — listen for the injected menu's `hub:auth` event and
  upload current progress (don't pull — it would overwrite an active game):

  ```js
  window.addEventListener('hub:auth', (e) => {
    if (e.detail.user) hub.putSave('main', state).catch(() => {});
  });
  ```

`hub:auth` fires on the `window` whenever the player logs in or out via the
menu (`e.detail.user` is the user or `null`). Games that have their own local
persistence should construct a **cloud-only** client so failures just fall
through to local rather than to the SDK's own localStorage:
`new Hub({ offline: 'never' })` and wrap calls in try/catch.

---

## Inventory, economy & trading

A **server-owned** layer for games with collectible items and a soft currency:
a per-(user, game) **inventory** (counts of app-defined item keys) and **coin
balance**, plus async **player-to-player trades**. It's generic — any game can
use it. The unit everything moves in is a **bundle**:

```js
{ items: { "42": 3, "7": 1 }, coins: 120 }   // 3× item "42", 1× item "7", 120 coins
```

Item keys are opaque to the hub (`[A-Za-z0-9_.:-]`, ≤64 chars) — their meaning
is the game's. Quantities and coins are non-negative integers.

### What the ledger guarantees (and what it doesn't)

The hub is the authoritative **ledger**: you can never spend, escrow, or trade
away more than you hold (balances can't go negative), and a **trade conserves
goods** — nothing is created or destroyed when items move between players, so
there's no duplication exploit. What it does **not** do is validate *how* you
got an item: **minting via `grant` is client-trusted**, exactly like scores and
saves (the honor system from [Authentication & trust](#authentication--trust)).
So a modified client can mint itself goods — but it still can't dupe them
through trades or take what others won't give. If you need earned-item integrity,
gate `grant` behind logic you trust.

### Inventory

```js
const { items, coins } = await hub.getInventory();   // items: [{ key, qty }]

// Add goods you earned (opening a box, a level reward). Honor-system.
await hub.grant({ items: { "42": 1 }, coins: 25 });

// Atomic swap with "the house" — remove `take`, add `give`, all-or-nothing.
// Selling an item for coins (fails 409 if you don't own it):
await hub.sell({ "42": 1 }, 55);          // take 1× item 42, give 55 coins
// Buying from a shop (spend coins, receive an item):
await hub.buy(120, { "box.rare": 1 });    // take 120 coins, give 1× item
// Or the general form:
await hub.exchange({ coins: 120 }, { items: { "box.rare": 1 } });
```

Every inventory call returns the **new snapshot** `{ items, coins }`, so your UI
can re-render from the response.

### Trades

A trade is an **offer** from one player to another: *"I give you my `give`
bundle if you give me my `want` bundle."* When created, the sender's `give` is
**escrowed** (moved out of their inventory and held on the offer) so it can't be
double-spent. The recipient — typically **on their next login** — resolves it:

```js
// Send an offer (you must own everything in `give`; it's escrowed now):
const { offer } = await hub.createTrade('Brave-Otter-5807',
  { items: { "42": 2 } },           // give
  { coins: 100 },                   // want
  { note: 'two commons for 100' });

// On the recipient's side, list what's waiting and act on it:
const { offers } = await hub.listTrades({ box: 'incoming', status: 'pending' });
await hub.acceptTrade(offer.id);    // atomic swap (you must own `want`)
await hub.declineTrade(offer.id);   // escrow returns to the sender
await hub.counterTrade(offer.id,    // closes theirs, sends a linked reverse offer
  { coins: 60 }, { items: { "42": 2 } });
// The sender can withdraw a still-pending offer:
await hub.cancelTrade(offer.id);    // escrow returns to them
```

Each call returns `{ offer }` shaped from your perspective:

```js
{
  id, status,                       // pending | accepted | declined | cancelled | countered | expired
  direction,                        // 'incoming' | 'outgoing'
  from: { id, username }, to: { id, username },
  give, want,                       // bundles — `give` is what the *sender* offers
  note, parentId,                   // parentId links a counter to the offer it answers
  createdAt, resolvedAt, expiresAt,
}
```

Rules worth knowing:

- **Trading needs a claimed account.** `create`, `accept`, and `counter` require
  a non-guest (so escrow is never stranded on a throwaway cookie); `decline` and
  `cancel` work for anyone. Nudge guests to claim before trading.
- **Offers expire** (default 14 days) — escrow returns to the sender. A merged
  guest's inventory/coins/incoming offers fold into the account on login.
- Address the recipient by **username** (case-insensitive). `listTrades()` with
  no `box` returns both incoming and outgoing.

### Selling, with a confirmation (the dumplings pattern)

Server-owned inventory makes "sell this for coins" a one-call atomic op. Confirm
in the UI first, then commit and re-render from the returned snapshot:

```js
if (confirm(`Sell your ${name} for ${price} coins?`)) {
  const snap = await hub.sell({ [itemKey]: 1 }, price);   // 409 if you don't own it
  renderFrom(snap);                                        // { items, coins }
}
```

## Analytics

The injected menu records `play` and `heartbeat` automatically, so basic
numbers (total plays, unique players, active-now) work with no code from you.
Anonymous players are counted via a `hub_cid` cookie; signing in links the same
visitor to their account. To record your own events:

```js
await hub.event('level_complete');
```

`GET /_api/games/<slug>/analytics` and `GET /_api/analytics` return the
aggregates (also rendered on the catalog home page).

---

## Guests & claiming (no sign-in required)

Players don't have to sign in to keep progress. On a game page the injected
menu calls `hub.ensureGuest()`, which mints a **guest account** — a real user
with an auto-generated name like `Golden-Koala-5807` and no password — and a
session cookie. From then on saves, stats and scores persist under that guest,
tracked by the cookie across visits on that device.

A guest **isn't a different kind of record** — it's a normal user row. So
"finishing" the account is just a rename:

- `hub.claim(username, password)` — sets a username + password on the *current*
  guest row. Because every save/stat/leaderboard row already points at that
  `user_id`, **all progress carries over with nothing to migrate.** The menu's
  logged-out UI shows the guest name and a "Create account" form that calls this.
- `hub.login(username, password)` — for a returning player on a new device.
  If they're currently a guest, the server **folds that guest's progress into
  the account** (saves/profile keep the most recent; stats keep the larger
  value; leaderboard entries keep the better score) and deletes the guest, so
  nothing on the device is stranded. The menu reloads after login so each game
  re-pulls the merged save.

`me()` returns `user.guest: true|false` so you can tell them apart. Caveat:
a guest is tied to the browser cookie — clearing cookies loses an *unclaimed*
guest, so nudge players to claim.

## Authentication & trust

- Auth is a cookie-based session (`hub_session`, HttpOnly, SameSite=Lax,
  `Secure` behind HTTPS). The menu handles guest creation, claiming, login and
  logout; you rarely need to call these yourself.
- Because all games share one origin and one cookie, **any hosted game's code
  runs with the player's session.** Hosted games are trusted first-party. Don't
  embed untrusted third-party code in a game.
- Scores and stats are client-submitted (honor system). The hub validates types
  and keeps only best scores, but it cannot tell a real score from a forged
  one. If your game needs cheat-resistance, validate on logic you control
  before submitting.
- Cross-*site* requests (from other websites) are rejected on mutating calls.

---

## Endpoint reference

All under `/_api`. JSON in, JSON out; errors are `{ "error": "..." }` with a
4xx/5xx status. `:slug` must be a real game.

### Auth
- `POST /auth/guest` (no body) → `{user}` (+ session cookie) — idempotent; mints a guest if none
- `POST /auth/claim` `{username,password}` → `{user}` — register the current guest (must be a guest)
- `POST /auth/signup` `{username,password}` → `{user}` (+ session cookie)
- `POST /auth/login` `{username,password}` → `{user}` (+ session cookie; merges a guest if one is active)
- `POST /auth/logout` → `{ok}`
- `GET  /me` → `{ user|null, profiles:[{game,displayName}] }` (`user.guest` flags an unclaimed guest)
- `GET  /me/records[?game=slug]` → `{ games:[{slug,title,records:[{key,title,score,sortDir,rank}]}] }` — the caller's standings
- `GET  /me/snapshot[?top=5]` → `{ user, games:{<slug>:{profile,saves,stats,inventory}}, records, leaderboards }` — everything for the current user, in one request (powers the SDK's `prefetchAll`)

### Profile (auth required)
- `GET /games/:slug/profile` → `{ profile|null }`
- `PUT /games/:slug/profile` `{displayName?,data?}` → `{profile}`

### Saves (auth required)
- `GET    /games/:slug/saves` → `{ saves:[{slot,label,updatedAt}] }`
- `GET    /games/:slug/saves/:slot` → `{ save|null }`
- `PUT    /games/:slug/saves/:slot` `{data,label?}` → `{ok,updatedAt}`
- `DELETE /games/:slug/saves/:slot` → `{ok}`

### Stats
- `GET  /games/:slug/stats` → `{stats}` (own, auth) — or `?user=<id>` (public)
- `POST /games/:slug/stats` `{key,value,mode}` → `{key,value}` (auth)

### Leaderboards
- `POST /games/:slug/leaderboards/:key/scores` `{score,title?,sort?,meta?}` → `{board,best,rank}` (auth)
- `GET  /games/:slug/leaderboards` → `{ boards:[{key,title,sortDir}] }`
- `GET  /games/:slug/leaderboards/:key?limit=50` → `{ board, entries:[{rank,userId,username,score,meta}] }`
- `GET  /leaderboards?top=5` → `{ games:[{slug,title,boards:[{key,title,sortDir,top:[...]}]}] }`

### Inventory & economy (auth required)
- `GET  /games/:slug/inventory` → `{ items:[{key,qty}], coins }`
- `POST /games/:slug/inventory/grant` `{items?,coins?}` → new snapshot (add goods)
- `POST /games/:slug/inventory/exchange` `{take?,give?}` → new snapshot (atomic remove `take` + add `give`; 409 if uncovered)

### Trades (auth required; create/accept/counter need a claimed account)
- `POST /games/:slug/trades` `{toUser,give?,want?,note?}` → `{offer}` (escrows `give`)
- `GET  /games/:slug/trades?box=incoming|outgoing&status=pending` → `{offers:[...]}`
- `POST /games/:slug/trades/:id/accept` → `{offer}` (atomic swap; 409 if you can't cover `want`)
- `POST /games/:slug/trades/:id/decline` → `{offer}` (recipient; refunds escrow)
- `POST /games/:slug/trades/:id/cancel` → `{offer}` (sender; refunds escrow)
- `POST /games/:slug/trades/:id/counter` `{give?,want?,note?}` → `{offer}` (closes original, sends linked reverse)

### Analytics
- `POST /games/:slug/events` `{type}` → `{ok}` (anonymous allowed)
- `GET  /games/:slug/analytics` → `{slug,totalPlays,uniquePlayers,activeNow}`
- `GET  /analytics` → `{ global:{...}, games:[{slug,title,...}] }`

### Catalog
- `GET /games` → `{ games:[{slug,title,path,kind,hasImage,hubEnabled}] }`

---

## Advanced

Override slug or API base (e.g. testing against a remote host) with a fresh
client:

```js
import { createHub } from '/_hub/sdk.js';
const hub = createHub({ slug: 'my-slug', apiBase: '/_api' });
```

The injected `window.__HUB__` is the source of truth for slug/apiBase when the
game is hosted; the path-segment fallback only kicks in if it's absent.
