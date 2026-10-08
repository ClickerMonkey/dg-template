# The Hub — shared online features for diffenderfer.games

Every game hosted in this catalog can tap into a shared backend for free:
one user account across all games, saved game state, per-game stats,
leaderboards, and analytics — plus an injected menu (top-left) that handles
sign-in and navigation for you.

You do **not** need to run your own server, database, or auth to use any of
this. It is all served from the host at the same origin your game runs on.

Every game also gets the hub's **social layer** for free: friends, presence,
direct messages, invites, notifications and kid-safe chat live in the injected
menu. Online games (lobbies, invites into your game, relay rooms, own-server
tickets) follow **[`docs/multiplayer.md`](multiplayer.md)**. **Every** game,
online or not, should pause when hub UI opens. See
[Pausing when hub UI opens](#pausing-when-hub-ui-opens-huboverlay).

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
When your game (or the hub) has shipped changes the player hasn't seen, a
compact **What's new** card appears near the top of the drawer (see
[What's new](#whats-new-gamechanges)).

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
`menuPosition` only sets the *default* — each player can nudge the button to any
corner themselves with the two arrow buttons in the menu (one flips left↔right,
the other top↔bottom), so if your layout happens to overlap on their screen they
can move it. Their choice is saved per game (`hub:<slug>:menupos` in
localStorage) and wins over your default.

**Players can also drag the button anywhere.** Holding it for **3 seconds**
(mouse or touch — moving more than ~8px or letting go first cancels, so a normal
tap still opens the drawer) enters *move mode*: the button wiggles, a small
"Drag to move · tap to finish" hint appears and the device buzzes (if it can).
Drag it anywhere (pointer capture; the button is `touch-action: none`); it's
clamped fully on-screen inside the safe-area insets. After letting go it stays in
move mode — drag again, **tap** to finish, or it finishes itself after **3s
idle** — then the spot is saved for this game. Keyboard / no-pointer route: the
drawer's **Menu button → Move button** item enters the same mode with focus on
the button; **arrow keys** move it 8px (**Shift** = 40px), **Enter / Escape**
finish (those keys aren't passed to the game while moving). **Reset position**
(same drawer section) drops the override and restores your `menuPosition` +
`menuOffset`.

A dragged position is stored in the same key, anchored to the nearest corner so
it survives window resizes and orientation changes (it's re-clamped on each):
`{"corner":"bottom-right","dx":78,"dy":178}` — `dx`/`dy` are px from that
corner's side and top/bottom edges to the button. A plain corner string
(`"top-right"`, from the arrow buttons) is still accepted; the arrows keep a
dragged button's `dx`/`dy` and mirror it to the other side. A dragged position
overrides `menuPosition` and `menuOffset`; the drawer opens from the side the
button ends up on.

If the corner itself is fine but the button covers a bar of your own (a top
resource bar, a bottom command strip), push it away from the corner with
`game.menuOffset` — pixels (each `0`–`600`), either `{ "x": …, "y": … }` or a
plain number for vertical only. `y` moves it down for top corners / up for bottom
ones; `x` moves it inward from the left or right edge.

```json
"game": { "menuPosition": "top-right", "menuOffset": { "x": 0, "y": 100 } }
```

### Hiding the menu during play

If the button would cover the action, hide it while the game is actively being
played and show it again whenever the player could want it (paused, a menu or
modal open, title/lobby/game-over screens):

```ts
hub.menu.setVisible(false);   // battle running, unpaused, no modal
hub.menu.setVisible(true);    // paused / any menu open
hub.menu.hide(); hub.menu.show(); hub.menu.visible; // shorthands + last requested state
```

Behaviour:

- **Transition:** the button fades/shrinks out (~0.2s; instant with
  `prefers-reduced-motion`). Calls are cheap and idempotent — call it every frame
  or on every state change.
- **Accessibility:** a hidden button is `visibility:hidden`, `aria-hidden="true"`
  and `tabindex=-1`, and is blurred if it had focus.
- **Still reachable:** a tiny (18px) hotspot in the button's screen corner (or,
  if the player dragged the button, a button-sized hotspot at its saved spot) stays
  live while hidden — hovering it with a mouse or tapping it peeks the button
  back for a few seconds. The **gamepad Select** button still toggles the drawer
  (there is no keyboard shortcut); an open drawer always shows the button, and
  hiding never closes an open drawer. Best practice: show it from your own pause
  menu so players find hub functions (account, boards, fullscreen) there.
- **Load order / no SDK:** the state is page-wide — `window.__HUB_MENU_VISIBLE__`
  (`false` = hidden, absent = visible) plus a `hub:menu-visibility` window event
  (`detail: { visible }`). `menu.js` reads the global when it boots, so calling
  this before the menu loads works. Games without the SDK can do the same by
  hand: `window.__HUB_MENU_VISIBLE__ = false; dispatchEvent(new CustomEvent('hub:menu-visibility', { detail: { visible: false } }))`.
  The element is `#hub-menu-root`; the state is not persisted.

### Pausing when hub UI opens (`hub.overlay`)

The hub's menu drawer, chat, player cards, invite toasts the player interacts
with, and the notification panel all cover the game. The hub tracks them as one
**overlay stack** and tells the game when it goes from closed to open and back.
**Every game should adopt it**, single-player included, because a player reading
a message shouldn't lose a life:

```ts
hub.overlay.autoPause({
  pause: () => game.pause(),          // exactly what your own pause does
  // turn-based / idle games only: resume: () => game.resume(), resumeOnClose: true,
});
```

- `open` fires once when the stack goes 0 → 1, and `close` fires once when it
  returns to 0. Nested dialogs don't flicker. Payload: `{ reason, canPause }`, where
  `reason` is `'menu' | 'chat' | 'dialog' | 'keyboard' | 'invite' | 'notify'`.
- **Action games: don't auto-resume.** Leave `resumeOnClose` off and show your
  pause screen so the player resumes deliberately.
- **Online matches can't pause.** After `hub.mp.setBusy(true)`, events carry
  `canPause: false` and `autoPause` skips `pause()`.
- While open, the hub disables your `play` input group automatically. Your own
  enable/disable calls for `play` are recorded and the last one is applied on close.
- Lower level: `hub.overlay.on('open' | 'close', cb)` (returns an unsubscribe fn),
  `hub.overlay.isOpen`, `hub.overlay.canPause`, and the window events
  `hub:overlay-open` / `hub:overlay-close`. The stack is a page-wide singleton
  (`window.__HUB_UI__`), shared by `/_hub/hub.js`, vendored copies and the hub's
  social runtime.

Full rules: [`docs/multiplayer.md`](multiplayer.md) §4.

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
| `hub.menu.setVisible(bool)` / `.show()` / `.hide()` / `.visible` | Show/hide the injected menu button (sync, no promise) — see [Hiding the menu during play](#hiding-the-menu-during-play). |
| `hub.favorites()` / `hub.setFavorite(slug, on)` | Starred games (`{ games: string[] }`) — see [Favorites](#favorites). |
| `hub.overlay.autoPause({ pause, resume?, resumeOnClose? })` / `.on('open'\|'close', cb)` / `.isOpen` | Pause when hub UI covers the game (sync) — see [Pausing](#pausing-when-hub-ui-opens-huboverlay). |
| `hub.presence` · `hub.social` · `hub.mp` · `hub.rooms` · `hub.notify` | Presence, friends/player cards, invites + launches + tickets, relay rooms, quiet mode — see [Social & multiplayer](#social--multiplayer) and `docs/multiplayer.md`. |
| `hub.race` | Races: a single-player game becomes multiplayer — same seed for everyone, the hub's waiting card / HUD / referee / result / history; the game reports `status` and `finish`/`lose`. See `docs/multiplayer.md` §14. |

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
together with its siblings: `input.ts`, `overlay.ts`, `legacy.ts`, `daily.ts`,
`uistack.ts`, and `social/rt-types.ts` (types only). dg-template games do this with
`npm run sync-hub`. It's a dependency-free client with full types for every
endpoint. No `window.HubSDK` is needed, and there are no ambient globals. The social
namespaces are thin: they forward to the runtime `/_hub/social.js` that the menu
loads, so social features update without re-syncing.

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

- **Error details.** `HubError` also carries the server's machine-readable extras:
  `.code` (e.g. `'content_rejected'`, `'rate_limited'`, `'suspended'`,
  `'claim_required'`), `.reason`, `.hint` (a kid-friendly sentence to show)
  and `.retryAfterMs`. A **422** (text refused by the safety filter) throws the
  subclass **`ContentRejectedError`**. See
  [Content safety](#content-safety--the-rejection-contract).
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
network-first for navigations (falls back to the cached shell) and for
same-origin assets (3 s timeout, then the cached copy; the host answers with
cheap ETag/304 revalidations), cache-first for CDNs. Players stuck on an old
version (e.g. an installed home-screen app with no reload) can use the menu's
**Update & reload** button: it unregisters the service workers, clears Cache
Storage and reloads from the network, keeping saves and settings. `/_api/*` is never
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
  (`circle`/`round`/`square`/`pill`), `axis` for sticks (`both` default, or a
  single-axis `x`/`y` — e.g. a horizontal `pill` stick for a side-scroller),
  `color` (border/knob/pressed), `bg`,
  `text`, `opacity`, and `label`/`html`. Buttons cluster *beside* a joystick
  sharing the same corner (no overlap), and players can drag-reposition + the
  layout persists. Controls hide when a gamepad is active (toggle in the menu's
  **Controls**). By default, virtual controls show on touch devices and hide
  otherwise; a game that doesn't need them on touch can set a different default
  with `hub.input.setVirtualDefault(false)` (pass `true` to force-show, `null`
  to restore auto). The player's own show/hide toggle always wins over this.
- Keyboard always works; **mouse and gamepad are last-used-wins** (using the
  gamepad ignores the mouse until the mouse moves again). Subscribe with
  `hub.input.on('sourcechange', s => …)`.

### Navigable menus (the easy way)

The hub menu is gamepad-navigable automatically. To make **your game's own**
menus (pause, game-over, title) gamepad-navigable, one line is usually enough:

```ts
hub.input.autoNavigate('#pause button, #gameover button, #title button');
// optional: hub.input.autoNavigate(sel, { back: () => resume() });  // B button
```

Pass a CSS selector (or a function returning elements). Whenever any match is
**visible** and a **gamepad** is the active device, the d-pad/stick move a
highlight ring across them and **A** clicks the focused one (**B** → `back`). It
re-queries every frame, so it follows menus showing/hiding — call it once at
startup. It's a no-op for mouse/touch/keyboard (those use the menu natively),
and it does **not** suppress gameplay (your existing pause logic gates that), so
the gamepad's pause/Start still works to resume.

### Navigable groups (full control)

For finer control (or Pixi-drawn UI), mark a group `navigable` to let the
gamepad/keys traverse and activate UI —
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
(idempotent — safe to leave). Each entry is `{ key, title, sort, showZeros? }`
(`sort` is `"desc"` by default, `"asc"` for "lower is better" like times):

```json
"game": {
  "type": "static", "title": "Geometry Dungeon", "serveDir": "dist",
  "leaderboards": [
    { "key": "arcade-points", "title": "Arcade — Points", "sort": "desc" },
    { "key": "any%-time",     "title": "Any% Time",       "sort": "asc"  }
  ]
}
```

**Zero scores are hidden by default.** A score of exactly `0` is treated as
"hasn't really played" and is omitted from every board view (the catalog, a
game's own board, and a player's own records). If a `0` is a *legitimate* result
for your board (e.g. fewest-deaths, lowest-time), set `"showZeros": true` on the
declaration to keep zeros visible.

**Server-source boards.** An own-server game can add `"source": "server"` to a
declaration. That board then accepts scores **only** from the game's server
(trusted results via `hub-server.mjs`, see `docs/multiplayer.md` §9), and the
browser's `submitScore` to it gets a 403. Use it for competitive online boards.

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

## Daily challenges

Opt a game in with `"dailyChallenges": true` in its `package.json` `game` block.
Each daily-enabled game offers **one deterministic challenge per UTC day**; a
player can complete each day once, and can back-fill the **last 30 days**. The
hub:

- shows a **calendar** in the injected menu (in a daily game) — today is a
  wiggly ★, past-incomplete days are plain ★, completed days are ✓; a **wiggly
  star** also rides the menu button while any day is open;
- adds a cross-game **Daily** section to the home page (per-game day chips +
  a global standing);
- auto-creates a per-game **"Daily Challenges"** leaderboard ranked by days
  completed, and a **global** board summing completions across every game.

### Wiring a game (two calls)

```js
// 1) Register how a day is played. `seed` is the server's deterministic seed
//    for (game, day) — derive difficulty/level/etc from it. Difficulty should
//    be random (drawn from the seed) so each day feels fresh.
hub.daily.define({
  play(challenge) {        // { day, seed, token }
    const rng = mulberry32(challenge.seed);
    const difficulty = DIFFS[Math.floor(rng() * DIFFS.length)];
    startLevel(deriveLevel(rng), difficulty);   // your game's "start this level"
  },
});

// 2) When the player finishes, record it (only if a daily is active).
if (hub.daily.active) hub.daily.complete({ score, difficulty, timeMs });
```

That's it. The menu starts a day (`hub.daily.startAndPlay(day)` → your `play`),
and a deep link `/<slug>/?daily=YYYY-MM-DD` (from the home hub) auto-starts that
day on load. `complete(meta)` stores the metadata and bumps your completion
count. A **failed/abandoned** attempt records nothing — the player can retry.

**Seed-based vs level-based.** Procedural games derive everything from the seed
(`mulberry32(seed)` → difficulty + layout). Level-based games (a fixed set of
levels) just pick one, e.g. `load((seed % 100) + 1)`. Either way the same date
is the same challenge for everyone, because the seed is server-issued.

> Completion is gated by a short-lived **signed token** the server mints when a
> day starts (so a client can't fabricate completions), and is idempotent — a
> day counts once. Daily runs are kept separate from a game's normal
> progress/boards.

### `hub.daily` API

| call | what |
| --- | --- |
| `hub.daily.define({ play })` | Register the day-runner (once, at load). |
| `hub.daily.active` | The in-progress `{ day, seed, token }`, or null. |
| `hub.daily.complete(meta?)` | Record the active day with optional metadata. |
| `hub.daily.startAndPlay(day)` | Start a specific day (the menu calls this). |
| `hub.daily.status()` | This game's 30-day window + your completion state. |
| `hub.daily.all()` | Every daily game + the global standings (home hub). |

Events: `hub:daily-started`, `hub:daily-complete`, `hub:daily-error`.

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

## Favorites

Players can **star** games — on the home page's game cards or in the menu's game
list. Starred games sort to the top of both (the home page's other games follow the
player's chosen sort, *Most played* or *A–Z*, remembered on the device). Stars are stored per account (guests too; they follow a guest through
claim/login) and mirrored to `localStorage`, so the list still renders offline.

```js
const { games } = await hub.favorites();          // ['tetrablox', 'flux'] — oldest star first
await hub.setFavorite('tetrablox', false);         // unstar → { games }
```

`setFavorite` needs a connection. Only registered games can be starred (404
otherwise). The menu draws the star buttons, so most games never call these.

---

## What's new (`game.changes`)

Players see what changed since they last looked: a compact **What's new**
button on the home page with a count (it opens the notes, grouped by game, in a
modal with a **Mark all as seen** button) and, in every
game's menu, a compact **What's new** card with a count (it opens the list).
The menu button gets a small cyan dot while anything is unseen. Nothing to wire
up in code: you only keep a list in `package.json`.

```json
"game": {
  "changes": [
    "Levels 21 to 30 are here! Can you beat them all?",
    "Fixed a bug where the music kept playing after you paused.",
    { "id": "hats", "text": "Your crew can wear hats now. Find them in the shop!" }
  ]
}
```

**Every time you ship something a player would notice, append one line.** Write it
for a player (often a kid): what they can now do or what got better, in plain
words, one or two short sentences. Leave out internal work (refactors, build
changes, test fixes).

| Good | Not good |
| --- | --- |
| "You can now pause with the Escape key." | "Added pause handler" |
| "Fixed the bug where your score reset when you changed levels." | "Fix #42 score state" |
| "Levels 21 to 30 are here!" | "Refactored level loader, bumped vite" |

How it works:

- **Timestamps come from the deploy.** Every host boot (every deploy) reads each
  live game's list. A note the database hasn't seen before is stamped with that
  moment (when it went live). Notes already stored keep their original time.
  A build that fails doesn't touch the game's notes.
- **Identity.** A plain string is identified by its text (case, spacing and
  trailing punctuation are ignored), so **rewording a string announces it
  again**. To reword without re-announcing, use `{ "id": "short-key", "text": "…" }`
  (id: letters, digits, `_ . : -`, up to 64 chars); its text can then change freely.
  Typos you fix in a plain string will show as a new note, so use an id for long-lived notes you may edit.
- **Removing** a note from the list stops it showing (it stays in the database,
  and keeps its date if you put it back). Order doesn't matter, but appending
  keeps the file readable. Up to 200 notes are read, 280 characters each.
- **What's listed:** notes from the last **30 days**, at most **6 per game** and
  **30 in total**, newest first. Hidden (`game.hidden`) and removed games never show.
- **What counts as new** (per player, guests included, kept across guest →
  account): a note is new when it went live after the player last cleared it
  *and* after their account was created. Brand-new players aren't handed the
  whole history.
- **Clearing.** "Got it" in a game's menu marks **that game's** notes and the
  host's own notes as seen (that's what the game's list shows). **Mark all as
  seen** on the home page (or "Got it" in the home page's menu) marks
  **everything** seen, across all games.
- **Signed out** (home page with no session): the device remembers when it
  last cleared (`localStorage` `dg:changes-seen`, shared by the panel and the
  menu). A first visit starts that clock, so it shows nothing yet.
- **The host's own notes** (menu, friends, chat, home page…) live in the same
  field in the diffenderfer-games repo's `package.json` and show as
  "diffenderfer.games" on the home page and in every game's list.

The API (most games never call it): `GET /_api/changes[?game=slug]` and
`POST /_api/changes/seen`, see [Endpoint reference](#whats-new-handlerschangesjs).

---

## Social & multiplayer

The hub runs one kid-safe social layer for the whole site. Games get it with no
code; online games opt into more. **The implementer's guide is
[`docs/multiplayer.md`](multiplayer.md).** The design and the wire contract
are in `docs/plans/multiplayer.md` / `docs/plans/multiplayer-impl.md` in the hub
repo.

- **For every player, in every game:**
  - **friends** (added by exact username or from a player card) and **presence**
    ("🟢 Playing Flux · Level 3"), friends only, with privacy and blocks;
  - **direct messages** between mutual friends only, safety-checked *before*
    delivery;
  - **invites** into any online game, and **parties** that move between games;
  - **game suggestions** with a public upvote board;
  - opt-in **browser/phone notifications** (`dm`, `friend_request`,
    `friend_online`, `lobby_open`);
  - **report/block** on every name and message.

  Guests get rooms and quick-chat but no friends, DMs, invites or notifications.
- **How it loads:** the injected `menu.js` loads **`/_hub/social.js`**, which opens
  one WebSocket per tab (`/_ws`), renders the Friends card (which opens the Friends window), toasts and dialogs,
  and installs `window.__HUB_RT__`. The client namespaces forward to it, queueing or
  replaying until it arrives.
  - `hub.presence.set({ kind, detail?, joinable?, watchable?, room?, public?, openSeats?, mode? })` / `.clear()`
  - `hub.social.openPlayer({userId}|{username})`, `openFriends()`, `openChat(id)`,
    `openInvite({userId?, mode?})`, `openSuggest()`, `openNotify({game?})`,
    `friends()`, `counts()`, `chatMode(userIds?)`, `on(ev, cb)`
  - `hub.mp.onLaunch(cb)`, `onJoinInfo(cb)`, `invite(userId, {mode?})`,
    `setBusy(busy, {label?})`, `ticket()`, `setJoinInfo(partyId, info)`, `party()`
  - `hub.rooms.create(opts)` / `join(codeOrId, {spectate?})` / `list({mode?})` →
    a room handle with `ready/seat/start/send/setState/chat/quick/kick/leave/end`
    and `on('room'|'msg'|'state'|'chat'|'kicked'|'closed'|'abandoned', cb)`
  - `hub.notify.setQuiet(quiet)`
  - `hub.race.define({start, end?, exit?, hud?})`, `create({params, public?})`, `join(code)`,
    `list()`, `browse()`, `openHistory()`, `history()`, `status(stats, progress?)`,
    `finish(stats?)`, `lose(stats?)`, `forfeit()`, `leave()`, `rematch()`, `current()`, `on(ev, cb)`
    — races, opted in with `game.race` (`docs/multiplayer.md` §14)
- **Opting a game in** is the `game.multiplayer` block in `package.json`
  (`lobby`, `players`, `transport: "hub-rooms" | "own-server"`, `invites`, `join`,
  `spectate`, `modes`, `quickChat`, `chatAllow`). The catalog shows an **Online**
  tag, and `GET /games` exposes a summary for the invite picker.
- **Own-server games** vendor the zero-dependency game-server SDK
  `clients/server/hub-server.mjs` (also served at `/_hub/hub-server.mjs`). With it
  they verify 60-second identity tickets offline, check chat, and post trusted results
  through the loopback-only `/_api/internal/*` routes. The host injects
  `HUB_URL` and `HUB_APP_KEY` into hub-enabled process apps.
- **Pages:** **`/parents`** is a plain-language page for parents (how chat is kept
  safe, the parent chat lock, the contact link), written to match the live config.
  **`/_admin`** is the admin console (suggestions, reports, moderation log, filter lab,
  users and suspension, live switches). It's a 404 for anyone who isn't an admin.

---

## Content safety & the rejection contract

**Everything players type** is checked server-side before it's stored or shown:
DMs, room/party chat, suggestions, usernames (signup/claim/rename), per-game
`displayName`, trade notes, presence `detail` and room names. The pipeline is:

1. shape limits;
2. a character allowlist;
3. normalization (leet, repeats, separators);
4. word/phrase lists;
5. link, contact and personal-info detectors;
6. **softening** of game-violence words ("kill" → "reduce to 0 HP", "bomb" →
   "confetti cannon", "shot" → "zapped");
7. spam and shouting checks, strikes and mutes;
8. an optional **AI reviewer** (OpenRouter, configured by env).

The client never receives the word lists. If the AI stage is configured but failing,
free text fails **closed** (`check_unavailable`) and quick-chat keeps working.

- **Free text only between mutual friends.** Everyone else gets **quick-chat**:
  phrase ids such as `gg`, emote ids such as `e:👍`, and a game's own
  `g:<slug>:<n>`. The effective **chat mode** (`on` | `quick` | `off`) is the
  strictest of:
  - the `HUB_CHAT` env;
  - the admin runtime switch, which can only tighten it;
  - any participant's parent chat lock or mute;
  - whether everyone is a mutual friend.
- **The rejection contract.** REST answers **422** and a WS ack answers `ok:false`,
  both with:

  ```json
  { "error": "That message can't be sent.", "code": "content_rejected",
    "reason": "link", "hint": "Links aren't allowed — try describing it instead.", "retryAfterMs": 0 }
  ```

  `reason` is one of:
  - `link`, `personal_info`, `contact`;
  - `language`, `slur`, `sexual`, `grown_up`, `unkind`, `threat`, `drugs`;
  - `spam`, `shouting`, `too_long`, `empty`, `chars`, `reserved`;
  - `rate_limited`, `muted`, `check_unavailable`, `chat_off`, `quick_only`, `suspended`.

  **UI rules:**
  - keep the draft, and show `hint` under the input;
  - for `muted` / `rate_limited`, count down `retryAfterMs`;
  - never show a message as sent before the server acks it;
  - never say which word matched.

  Usernames rejected at signup/claim answer **400** with the same body.
- **Softened text is delivered softened.** The sender sees it too, with a one-time
  "Some words were swapped for friendlier ones ✨". A game may exempt soften-list
  words for its own rooms with `game.multiplayer.chatAllow` (e.g. `["shot"]` for
  pool). It can never exempt reject-list words.
- **Suspended accounts** keep single-player (saves, stats, daily, profile). Every
  social, multiplayer, suggestion, trade and `players/*` route answers **403
  `{code:'suspended'}`**, and the socket is closed with 4003.
- Word lists live in `src/hub/safety/lists/` (format and attribution in its
  `README.md`). The corpora in `test/fixtures/filter/` lock the behaviour in.

---

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

### Daily challenges (game must set `dailyChallenges: true`)
- `GET  /games/:slug/daily` → `{ enabled, today, window:[{day,seed,completed,completedAt,meta}] }` (per-user state)
- `POST /games/:slug/daily/:day/start` → `{ token, day, seed, expiresAt, alreadyCompleted, meta }` (auth; mints a signed token)
- `POST /games/:slug/daily/:day/complete` `{token,meta?}` → `{ ok, day, count, rank }` (auth; idempotent)
- `GET  /daily` → `{ games:[{slug,title,today,window:[...]}], global:[{rank,userId,username,score}] }` — cross-game hub + global standing

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
- `GET /games` → `{ games:[{slug,title,path,kind,hasImage,hubEnabled,multiplayer}] }` — `multiplayer` is `{transport,players,invites,join,spectate,modes:[{key,title}]}` or `null`

### Favorites (auth required)
- `GET /favorites` → `{ games:[slug] }` (oldest star first)
- `PUT /favorites/:slug` `{on}` → `{ games }` (idempotent; 404 for an unknown game)

Every route below needs a signed-in, **not suspended** user (403 `suspended`)
unless marked *public*. *claimed* = not a guest (403 `claim_required`). Text
fields go through the filter and answer **422** `content_rejected` on refusal.

### What's new (`handlers/changes.js`)
- `GET /changes[?game=slug][&since=ms]` (*public*) → `{ items:[{id,game,title,text,at,new}], unseen, signedIn }`. `game`: that game's notes + the host's (`game: "_hub"`); omitted = every game. Newest first; last 30 days, ≤6 per game, ≤30 total. `since`: used only when signed out (the device's last-cleared time; none = nothing is new).
- `POST /changes/seen` `{ game: slug }` | `{ all: true }` → `{ ok, seenAt }` (auth required, guests OK; 404 for an unknown game). `game` marks that game's notes and the host's; `all` marks everything.

### Social (`handlers/social.js`)
- `GET  /social/config` (*public*) → `{chatMode, ai, contactUrl, parentsUrl, vapidPublicKey, quickChat:{id:text}, emotes, limits:{dmMaxChars,roomChatMaxChars,suggestionTitleMax,suggestionBodyMax}, avatars}`
- `GET  /social/me` → `{me:{id,username,avatar,guest,role,privacy,dmPolicy,chatLock,mutedUntil,suspendedUntil?}, notify, pushSubs}` (allowed while suspended)
- `PUT  /social/me` (*claimed*) `{avatar?, privacy?: 'friends'|'nobody', dmPolicy?: 'friends'|'nobody'}` → `{me}`
- `POST /social/chat-lock` (*claimed*) `{on:true}` or `{on:false, password}` → `{me}` (parent lock; turning it off needs the password, 5 tries / 15 min, 403 `bad_password`)
- `GET  /social/friends` → `{friends:[FriendEntry], incoming, outgoing, blocked}` (guests get empty lists)
- `POST /social/friends` (*claimed*) `{username}` or `{userId}`, plus optional `message` → `{status:'requested'|'friends'}` (a reverse request auto-accepts; `message` is a first message, moderated as a DM up front — a rejection is a 422 and no request is made — then held and delivered as the first DM once they're friends, never shown to a non-friend; errors `no_player`, `bad_target`, `guest_target`, `blocked`, `pending_limit`, `friends_limit`, `friend_requests_off`, `rate_limited`)
- `POST /social/friends/:id/accept` · `/decline` (*claimed*) → `{ok}`
- `DELETE /social/friends/:id` (*claimed*) → `{ok}` (unfriend or cancel an outgoing request)
- `PUT  /social/friends/:id/notify` (*claimed*) `{online}` → `{ok}` ("tell me when they're online")
- `POST /social/blocks` (*claimed*) `{userId}` → `{ok}` · `DELETE /social/blocks/:id` → `{ok}`
- `GET  /social/players/:id` · `GET /social/players/by-name/:name` → `PlayerCard {id,username,avatar,guest,relation,presence,canFriend,canMessage,canInvite,canReport}`
- `GET  /social/recent` (*claimed*) → `{players:[{…PlayerLite, game, lastAt}]}`
- `GET  /social/counts` (*public*) → `{online, byGame:{slug:n}}`

### Messages (`handlers/messages.js`, mutual friends only)
- `GET  /social/conversations` → `{conversations:[{user, last, unread}]}`
- `GET  /social/messages/:userId?before=<id>` → `{messages (oldest→newest, ≤50), more, mode:'on'|'quick'|'off'}`
- `POST /social/messages/:userId` `{text}` or `{quick}` → `{message:{id,from,to,text,quick?,at,read,softened?}}` (moderated **before** it's stored or delivered; 403 `not_friends` / `dms_closed`, 422 `chat_off` / `quick_only` / content reasons)
- `POST /social/messages/:userId/read` `{upTo}` → `{ok}`

### Reports
- `POST /social/reports` `{kind:'message'|'user'|'username'|'suggestion'|'room_chat'|'presence', targetUserId, refId?, reason:'mean'|'bad_words'|'personal'|'inappropriate'|'spam'|'other'}` → `{ok, id}` (the server snapshots the content itself; 3 independent claimed reporters in 24 h → auto-mute + admin flag)

### Notifications (`handlers/notify.js`)
- `GET  /social/notify` → `{dm, friend_request, friendOnlineAll, friendOnline:[userId], lobbyOpen:[slug]}`
- `PUT  /social/notify` `{kind:'dm'|'friend_request'|'friend_online'|'lobby_open', target?, enabled}` → the same shape (`friend_online` with no `target` is the "any friend" switch)
- `POST /social/push` `{subscription}` → `{ok}` · `DELETE /social/push` `{endpoint}` → `{ok}` (Web Push; ≤5 per user)

### Suggestions
- `GET  /suggestions?sort=votes|new` (*public*) → `{approved:[Suggestion], mine:[Suggestion]}`
- `POST /suggestions` (*claimed*) `{title (≤60), body (≤500)}` → `{suggestion}` (3/day, 20 pending)
- `POST /suggestions/:id/vote` · `DELETE /suggestions/:id/vote` (*claimed*) → `{votes, voted}`
- `DELETE /suggestions/:id` (*claimed*) → `{ok}` (withdraw your own pending one)

### Multiplayer (`handlers/mp.js`)
- `POST /mp/invites` `{to, game, mode?}` → `{invite, launchToken, url}` (creates/reuses the inviter's party; 403 `cannot_invite`, 404 `not_multiplayer`, 400 `not_supported` / `bad_mode`, 409 `party_full` / `already_member`)
- `POST /mp/invites/:id/accept` → `{launchToken, url}` · `POST /mp/invites/:id/decline` → `{ok}` · `DELETE /mp/invites/:id` → `{ok}` (cancel)
- `GET  /mp/launch/:token` → `{launch:{kind:'host'|'guest'|'join'|'watch', game, mode?, partyId?, party?, joinInfo?, room?, host?, target?}}` (single use, 2 min; 404 `launch_invalid`)
- `POST /mp/parties/:id/join-info` (leader) `{info:{k:v} (≤8 keys, values ≤64)}` → `{ok}` · `POST /mp/parties/:id/leave` → `{ok}`
- `POST /mp/join` `{userId, watch?, fromLobbyOpen?}` → `{launchToken, url}` (from a friend's joinable/watchable presence; 409 `not_joinable`)
- `POST /mp/ticket` `{slug}` → `{ticket, expiresAt}` (60 s identity ticket for that game's own server)

Live traffic (presence, friends/DM/invite events, hub relay rooms `room.*`, party
chat) is on the WebSocket **`/_ws`**: JSON envelopes `{t:'op', id, op, d}` →
`{t:'ack', id, ok, d|err}`, plus pushed `{t:'ev', ev, d}`. Games use it only through
`hub.rooms` / `hub.presence`. The op and event tables are in
`docs/plans/multiplayer-impl.md` §4 and §6.

### Internal (game servers only)
Loopback only, no `x-forwarded-for`, headers `x-hub-app: <slug>` + `x-hub-key: <HUB_APP_KEY>`.
Anything else gets a 404. Use `hub-server.mjs` rather than calling these by hand.
- `POST /internal/chat` `{userId, text?|quick?, members:[userId], context?}` → `{ok:true, text, quick?, softened?}` or `{ok:false, err}` (never a 422)
- `POST /internal/results` `{room?, mode?, players:[{userId, place?, won?, stats?, scores?}]}` → `{ok}` (increments `online_games`/`online_wins` + `stats`; `scores` go to `source:"server"` boards only; ≤16 players)
- `POST /internal/recent` `{userIds}` → `{ok}`

### Admin (role `admin` only)
- `GET  /admin/overview` → online/byGame/rooms/parties, AI health, switches, open reports, pending suggestions, flagged users
- `GET  /admin/reports?status=open|resolved` · `POST /admin/reports/:id/resolve` `{action:'dismiss'|'hide'|'mute'|'suspend'|'rename', duration?, note?}`
- `GET  /admin/modlog?userId=&verdict=&severity=&limit=`
- `POST /admin/filter/test` `{text, surface}` → `{result, forms}` · `GET|POST|DELETE /admin/filter/terms` `{term, list:'block'|'phrase'|'allow'|'soften', replacement?}`
- `GET  /admin/users?q=` · `GET /admin/users/:id` · `POST /admin/users/:id/suspend` `{duration:'24h'|'7d'|'30d'|'perm', reason}` · `/unsuspend` `{restoreMessages}` · `/mute` `{duration}` · `/unmute` · `/rename` `{username?, force?}`
- `GET  /admin/suggestions?status=` · `POST /admin/suggestions/:id` `{status?, adminNote?}`
- `GET|PUT /admin/switches` `{chat?:'on'|'quick'|'off', dms?, friendRequests?}` (can only be stricter than `HUB_CHAT`)
- `POST /admin/username-scan` → `{hits:[{id, username, reason}]}`

### Test mode (`HUB_TEST=1` and loopback only)
- `POST /test/suspend` `{userId, ms}` · `POST /test/unsuspend` `{userId}`
- `GET  /test/alerts/:userId` (notifications raised) · `GET /test/push/:userId` (the push outbox)
- `POST /test/reset-limits`

---

## Host configuration (env)

Social and multiplayer knobs, read at boot (`src/config.js` and the modules it
names). Set them on the systemd unit (see `DEPLOY.md`).

| Env | Default | Meaning |
|---|---|---|
| `HUB_ADMINS` | `ClickerMonkey` | Comma list of usernames (case-insensitive) that become admins once **claimed**. The role sticks to the user id. |
| `HUB_CHAT` | `on` | Site chat switch: `on` (friends free text + quick-chat), `quick` (phrases only), `off` (no messaging). The admin switch can only tighten it. |
| `HUB_MOD_OPENROUTER_KEY` / `HUB_MOD_MODEL` | unset | Enable the AI reviewer (both needed), e.g. model `anthropic/claude-haiku-4.5`. Unset means rules-only: friends keep free text, checked by the word filter. |
| `HUB_MOD_MODEL_SLOW` | `= HUB_MOD_MODEL` | Model for usernames and suggestions (not latency-sensitive). |
| `HUB_MOD_TIMEOUT_MS` | `2500` | AI call timeout. Failures fail closed (`check_unavailable`). |
| `HUB_CONTACT_URL` | unset | Parents' contact link on `/parents` (a mailto: or form URL). The section is hidden when unset. |
| `HUB_VAPID_PUBLIC` / `HUB_VAPID_PRIVATE` | generated into `DATA_DIR/vapid.json` | Web Push keys (base64url, raw P-256). Back the file up. New keys invalidate every push subscription. |
| `HUB_MP_SECRET` | random, persisted to `DATA_DIR/mp-secret` | Root secret for game tickets and per-game `HUB_APP_KEY`s. |
| `HUB_REALTIME` | on | `0` disables `/_ws` (an escape hatch: social goes quiet, single-player is unaffected). |
| `HUB_TEST` | off | `1` = test mode: relaxed limits, fake AI, push outbox, `/_api/test/*`. **Never in production.** |
| `HUB_LIMITS_JSON` | `{}` | JSON overrides for any `SOCIAL_LIMITS` field (tests). |
| `HUB_APPS_DIR` | `<repo>/apps` | Where to scan for apps (the test kit points it at a temp dir). |

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

---

## Changelog

- **2026-10-08** — **What's new.** Games list player-facing changes in
  `package.json` `game.changes`; each deploy stamps new notes with the time it
  went live. Shown in a home-page panel and a compact menu card (with a count and
  a dot on the menu button), with per-player seen marks (per game, or everything
  from the home page). See [What's new](#whats-new-gamechanges). `menu.js` and
  the home page only: **no client re-sync needed**, but please add notes to
  your game from now on.

- **2026-10-04** — **Native multiplayer & kid-safe social layer.**
  - **Social for every game, with no code:** friends, presence, DMs, invites,
    parties, game suggestions, opt-in Web Push notifications and report/block. It
    lives in the menu's Friends card / window via the new runtime `/_hub/social.js`
    over `/_ws`.
  - **New client namespaces:** `hub.overlay` (pause events + `autoPause`, **adopt in
    every game**), `hub.presence`, `hub.social`, `hub.mp`, `hub.rooms`, `hub.notify`.
  - **Favorites:** `hub.favorites()` / `hub.setFavorite()`.
  - **Errors:** `HubError` gains `code`/`reason`/`hint`/`retryAfterMs`, plus
    `ContentRejectedError` for 422s.
  - **Opt-in for online games:** `game.multiplayer`.
  - **Own-server games:** the game-server SDK `clients/server/hub-server.mjs`
    (tickets, chat, trusted results) and `"source": "server"` leaderboards.
  - **Safety:** a server-side content filter (with softening and an optional
    OpenRouter AI stage) on all player text. It now also covers usernames,
    `displayName` and trade notes. Login, signup and claim are rate-limited.
  - **Pages:** `/parents` and the admin console `/_admin`.
  - **New env:** `HUB_ADMINS`, `HUB_CHAT`, `HUB_MOD_*`, `HUB_CONTACT_URL`,
    `HUB_VAPID_*`, `HUB_MP_SECRET`, `HUB_REALTIME`, `HUB_TEST`, `HUB_LIMITS_JSON`,
    `HUB_APPS_DIR`.
  - **Vendored games need one re-sync** (`npm run sync-hub`) to get the new
    namespaces: the file set grows to `uistack.ts` + `social/rt-types.ts`. After that,
    social features update without re-syncing. Guide: [`docs/multiplayer.md`](multiplayer.md).

- **2026-09-27** — Movable menu button: hold it 3s (or drawer → **Move button**)
  to enter a wiggling move mode, drag it anywhere (or arrow keys), tap / Enter /
  3s idle to save. Stored per game in `hub:<slug>:menupos` as `{corner,dx,dy}`
  (nearest-corner anchored, re-clamped on resize, safe-area aware); overrides
  `menuPosition`/`menuOffset`. **Reset position** in the drawer. Works with
  `hub.menu.setVisible` (the peek hotspot follows the saved spot). `menu.js`
  only — no client re-sync needed. See [Where the menu sits](#where-the-menu-sits).

- **2026-09-27** — `hub.menu.setVisible(bool)` / `show()` / `hide()` / `visible`:
  games can hide the injected menu button during active play (fade transition,
  `aria-hidden`, corner peek hotspot, gamepad Select still opens it). Shared via
  `window.__HUB_MENU_VISIBLE__` + the `hub:menu-visibility` event. See
  [Hiding the menu during play](#hiding-the-menu-during-play). Vendored games
  need `npm run sync-hub` (or the copy routine) to get the typed API; the
  global/event work without it.
