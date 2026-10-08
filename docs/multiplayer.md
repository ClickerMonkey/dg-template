# Multiplayer & social: friends, invites, rooms and chat

> **Canonical copy:** this file lives in the hub repo (`diffenderfer-games/docs/multiplayer.md`).
> `npm run sync-hub` copies it into every game. Edit the hub's copy, never a game's.
> Background and decisions: the hub's `docs/plans/multiplayer.md` (the plan) and
> `docs/plans/multiplayer-impl.md` (the wire contract).

**Rule:** your game never handles identity, friends, chat or moderation. The hub
does all of that. Your game only:

1. calls **`hub.overlay.autoPause(...)`**. **Every game does this, single-player included**;
2. reports **presence** (`hub.presence.set`);
3. and, if it's an online game, handles **launches** (`hub.mp.onLaunch`), plays over
   **hub rooms** or its **own server** (with hub tickets), and sends chat **through the hub**.

## TL;DR: the rules

- **Never show player-typed text that didn't come back from the hub.** Chat is shown
  only after `room.chat()` resolves (or your server's `hub.chat()` says `ok`). Never
  show it optimistically, and never show the draft as "sent".
- **Never build your own text channel between players.** No free-text names, notes,
  lobby titles or chat sent over `room.send`, your WebSocket or `setState`. Text goes
  through `room.chat` / `room.quick` (hub rooms) or `hub.chat()` (own server).
- **No links, emails, phone numbers or social handles in game text.** Developer text
  is checked too: presence `detail` and `quickChat` phrases are filtered when they load.
- **No violent words in your UI copy.** Write "zap", "tag", "knock out" or "out of HP",
  not "kill", "shoot" or "bomb". Kid-safe copy matches what chat softens to.
- **Put `hub.social.openPlayer(...)` on every player name you render.** That is how
  players friend, message, block and report.
- **Free text is only for mutual friends.** Everyone else gets quick-chat phrases and
  emotes. The hub decides; your UI follows `room.info.chatMode` / `hub.social.chatMode()`.
- **Register `hub.mp.onLaunch` at boot** (within 8 s) if your game has `game.multiplayer`.
- **Call `hub.mp.setBusy(true)` during a live online match**, and `false` after it.
- **Online games ship with the required hub test scenarios** ([Testing](#12-testing-required)).
- **Single-player games can race** with no netcode: declare `game.race`, put a Race button on the menu,
  and build the puzzle from the shared seed ([Races](#14-races-single-player-games-go-multiplayer)).

Import from the vendored client (TypeScript games) or from the hub (plain JS):

```ts
import { hub, HubError, ContentRejectedError, OfflineError } from './hub/hub';   // dg-template games
// import { hub, ContentRejectedError } from '/_hub/hub.js';                     // plain-JS static games
import type { HubRoom, Launch, RoomInfo, PresenceInput } from './hub/hub';        // types come along too
```

Every call below is safe to make before the hub's live runtime (`/_hub/social.js`) has
loaded, and when it never loads (offline, `hub: false`, local `vite dev`). See
[Offline behaviour](#offline-and-no-hub-behaviour).

---

## Contents

1. [Do I need multiplayer? Choosing a transport](#1-do-i-need-multiplayer-choosing-a-transport)
2. [The `game.multiplayer` block](#2-the-gamemultiplayer-block)
3. [Presence](#3-presence)
4. [Pausing when the hub opens (every game)](#4-pausing-when-the-hub-opens-every-game)
5. [Notifications & `lobby_open`](#5-notifications--lobby_open)
6. [The launch contract](#6-the-launch-contract)
7. [Invites & parties](#7-invites--parties)
8. [Hub rooms (no server)](#8-hub-rooms-no-server)
9. [Own-server games](#9-own-server-games)
10. [Chat in your game](#10-chat-in-your-game)
11. [Showing other players · notification etiquette](#11-showing-other-players--notification-etiquette)
12. [Testing (required)](#12-testing-required)
13. [Definition of done](#13-definition-of-done)
14. [Races (single-player games go multiplayer)](#14-races-single-player-games-go-multiplayer)

---

## Architecture

```
your game (browser)                         the hub (same origin)
  hub.overlay / presence / social / mp ──►  /_hub/social.js runtime (window.__HUB_RT__)
  hub.rooms ─────────────────────────────►    one WebSocket per tab: /_ws
                                               presence · friends · DMs · invites · parties
                                               hub relay rooms · kid-safe chat filter
  own-server games only:
  hub.mp.ticket() ──► your server ──────────► hub-server.mjs: verifyTicket (offline),
     (60 s identity ticket)                     chat() / results() / recent() over loopback
```

- **The vendored client (`src/hub/hub.ts`) is thin.** `hub.presence`, `hub.social`,
  `hub.mp`, `hub.rooms` and `hub.notify` forward to the runtime the hub injects into
  every game page (`/_hub/social.js`). So social features update without re-syncing
  your game.
- **The hub draws the UI:** the Friends card in the menu (it opens the Friends window), player cards, chat, invite
  toasts, the invite picker and notification settings. Your game opens those screens
  (`hub.social.open*`) and reacts to their results (launches).
- **Players:** a **claimed** account can do everything. A **guest** can create and join
  rooms with quick-chat only, but can't friend, invite, DM or get notifications. A
  **suspended** account is single-player only: every social/multiplayer call fails with
  `code:'suspended'`.

---

## 1. Do I need multiplayer? Choosing a transport

Friends, presence, DMs and invites-*to-other-games* work in **every** game with no
code. You only need this doc's online parts when players play **together inside your
game**.

| Your game is… | Transport | `game.type` | Why |
|---|---|---|---|
| Turn-based, board/card, party, co-op puzzle, trading, "shared counter" | **`hub-rooms`** | `static` | No server to write. The host player's browser runs the rules and the hub relays. |
| Real-time but forgiving (co-op, casual races) with ≤8 players | **`hub-rooms`** | `static` | Fine if a cheating host doesn't matter. Results are untrusted. |
| Real-time physics, competitive, ranked, or anything a cheater would ruin | **`own-server`** | `process` | Your server is the authority. Trusted results feed hub stats and server-only boards. |
| Needs lockstep, tick-rate netcode, >8 players, or persistent worlds | **`own-server`** | `process` | Hub rooms cap at 8 seats and 30 msgs/s per seat. |

- **Hub rooms are not cheat-proof.** The host is a player's browser. Never post
  competitive scores from a hub-room match to a board that matters.
- **Keep `type: "static"` unless this table says `own-server`.** An own-server game is a
  process app; read the host's `HANDOFF.md` (process-app contract) first.

---

## 2. The `game.multiplayer` block

Add it to the `game` block in `package.json`. It makes your game an invite/join
target: the catalog shows an **Online** tag, and the invite picker lists the game.

```jsonc
"game": {
  "type": "static",
  "title": "Duel Dots",
  "serveDir": "dist",
  "multiplayer": {
    "lobby": "?mp=lobby",          // URL suffix the hub opens for invites/joins (relative)
    "players": [2, 4],             // [min, max], within 1..8
    "transport": "hub-rooms",      // "hub-rooms" (static) | "own-server" (process apps only)
    "invites": true,               // appear in the invite picker (default true)
    "join": true,                  // friends may Join from your presence (default true)
    "spectate": false,             // friends may Watch (default false)
    "modes": [{ "key": "ranked", "title": "Ranked", "players": [2, 2] }],   // optional
    "quickChat": ["Nice move!", "Your turn"],                               // optional extra phrases
    "chatAllow": ["shot"]                                                   // optional soften exceptions
  }
}
```

| Field | Default | Notes |
|---|---|---|
| `lobby` | `""` | Appended to `/<slug>/`. Must be relative: no leading `/`, no `..`, ≤200 chars. The hub adds `hub_launch=<token>` to it, so `?mp=lobby` becomes `?mp=lobby&hub_launch=…`. Your game must recognise the lobby URL and show its lobby. |
| `players` | `[2, 8]` | `[min, max]`, integers within 1..8. `max` caps party size and room seats. `min` is checked by `room.start()`. |
| `transport` | `hub-rooms` (static) / `own-server` (process) | `own-server` on a static app is rejected (falls back to `hub-rooms` with a warning). `hub.rooms.create` only works for `hub-rooms` games. |
| `invites` | `true` | `false` hides the game from the invite picker and `hub.mp.invite` fails with `not_supported`. |
| `join` | `true` | Friends see **Join** when your presence says `joinable`. |
| `spectate` | `false` | Friends see **Watch** when your presence says `watchable`, and `rooms.join(code, {spectate:true})` is allowed (≤20 spectators). |
| `quickMatch` | `false` | Reserved (quick match isn't built yet). |
| `modes` | `[]` | ≤16 entries: `key` matches `[A-Za-z0-9_-]{1,32}`, `title` ≤40 chars, optional `players`. Invites and rooms may name a `mode`; an undeclared mode is `bad_mode`. |
| `quickChat` | `[]` | ≤24 phrases, each ≤40 chars. Each is checked once at load (surface `quick_phrase`, **no softening**), and a phrase that fails is dropped with a warning in the host log. Ids are `g:<slug>:<index>` (the index in **your** array). |
| `chatAllow` | `[]` | ≤20 single lowercase words from the hub's **soften list** that your rooms' chat may keep unchanged (e.g. `"shot"` for a pool game). Applies only to your rooms' chat and your server's `hub.chat()`, never to DMs. Words that aren't soften-list entries are dropped at load. You can never allow a reject-list word. |

Problems are **warnings, never fatal**: a bad field falls back to its default. Check
the host log (`[registry] … warning`) after adding the block.

---

## 3. Presence

Friends see what you're doing in the hub menu ("🟢 Playing **Duel Dots** · Level 3").
Report it at natural screen changes. Calls are cheap, deduped and coalesced (150 ms),
so call `set` whenever your state changes.

```ts
hub.presence.set({ kind: 'menu' });                                       // title screen
hub.presence.set({ kind: 'playing', detail: 'Level 3 – Ice Cave' });      // single-player run
hub.presence.set({ kind: 'lobby', detail: 'Waiting for players', room: code,
                   joinable: true, public: true, openSeats: 2 });         // online lobby
hub.presence.set({ kind: 'playing', detail: 'Duel · round 2', room: code,
                   joinable: false, watchable: true });                   // online match
hub.presence.clear();                                                     // back to { kind: 'menu' }
```

`PresenceInput`:

| Field | Meaning |
|---|---|
| `kind` | `'menu' \| 'lobby' \| 'playing' \| 'watching' \| 'away'`. With several tabs, the most engaged wins: playing > watching > lobby > menu > away. A hidden or 5-minute-idle tab becomes `away` automatically. |
| `detail?` | ≤40 chars of **your** text. It is filtered without softening; a rejected detail is dropped silently and logged. Keep it factual: no player-typed text, no violent words. |
| `joinable?` / `watchable?` | Lights up **Join** / **Watch** for friends (needs `room`; `watchable` also needs `multiplayer.spectate`). |
| `room?` | Opaque join info, ≤64 chars of `[A-Za-z0-9_:-]`, visible to friends. A Join/Watch launch hands it back to the joiner as `launch.room`. **Hub rooms fill this in automatically** for seated players. Own-server games set it to their room code. |
| `public?` / `openSeats?` | A public lobby with open seats can trigger `lobby_open` notifications ([§5](#5-notifications--lobby_open)). |
| `mode?` | A mode key, shown to friends. |

- `game` and the game's title are added by the hub from your slug.
- **Privacy is automatic.** Only friends see presence, a player can hide it entirely
  (privacy "nobody"), and blocks hide it both ways. You never filter anything yourself.

---

## 4. Pausing when the hub opens (every game)

**Rule:** every game calls `hub.overlay.autoPause` once at boot. This includes
single-player and turn-based games. When the player opens the hub menu, a chat, a player
card, an invite or the notification panel, the game must not keep running underneath.

```ts
hub.overlay.autoPause({
  pause: () => game.pause(),     // do exactly what your own pause does (show your pause screen)
  // turn-based / idle games only:
  // resume: () => game.resume(), resumeOnClose: true,
});
```

- **`open`** fires when the first piece of hub UI opens (the stack goes 0 → 1).
  **`close`** fires when the last one closes. Nested dialogs (drawer → card → chat)
  produce **one** open/close pair.
- **Action games: leave `resumeOnClose` off** (the default). Show your pause screen
  so the player resumes deliberately. Turn-based and idle games may pass
  `resumeOnClose: true` with a `resume`.
- **Online matches can't pause.** While you've called `hub.mp.setBusy(true)`, events
  carry `canPause: false` and `autoPause` does **not** call `pause()`. The game keeps
  simulating, and the hub shows "Your match is still going!".
- **Input is handled for you.** While hub UI is open, the hub disables your `play` input
  group (so the paddle doesn't move while the player types). Your own
  `hub.input.enable/disable('play')` calls made meanwhile are recorded, and the last one
  is applied on close. So a game that pauses itself on `open` stays paused.
- `autoPause` registered while UI is already open pauses immediately. It returns a
  detach function.

Lower-level API, if you need more than `autoPause`:

```ts
const off = hub.overlay.on('open', (e) => {   // e: { reason, canPause }
  // reason: 'menu' | 'chat' | 'dialog' | 'keyboard' | 'invite' | 'notify'
  if (e.canPause) pauseGame(); else showToast('Match still running!');
});
hub.overlay.on('close', (e) => showPauseScreen());
hub.overlay.isOpen;      // true while any hub UI covers the game
hub.overlay.canPause;    // false during setBusy(true)
// window events too: 'hub:overlay-open' / 'hub:overlay-close' (detail = the same payload)
```

---

## 5. Notifications & `lobby_open`

Players opt in (everything is off by default) from **Notifications** in the hub menu,
or with one tap on the **"🔔 Get a buzz…"** card in the Friends window (it turns on
messages, requests and any-friend-online for that device). Alerts buzz the phone
when the site is in the background or closed; tapping one focuses the open app and
opens the chat / player card in place (or opens the site if nothing is running).

| Kind | What | Your part |
|---|---|---|
| `dm` | a friend's message (push only when no tab is visible) | nothing |
| `friend_request` | a new friend request | nothing |
| `friend_online` | any friend, or a chosen friend, comes online | nothing |
| `lobby_open` | **someone is waiting in a public lobby of a game I follow** | report lobby presence (below) + a 🔔 button |

**Put a 🔔 in your lobby** that opens the hub's settings focused on your game:

```ts
bellButton.onclick = () => hub.social.openNotify({ game: hub.slug ?? undefined });
```

**A lobby triggers `lobby_open`** when a **claimed** player's presence is all of these,
and holds for 15 s:

```ts
hub.presence.set({ kind: 'lobby', room: code, public: true, joinable: true, openSeats: 3 });
```

- Guests, private and full rooms never trigger it, and neither do players who hide
  their presence.
- Each recipient gets at most one per game every 15 minutes. It never goes to the
  creator, to people who blocked them, or to anyone already in your game.
- Tapping it opens `/<slug>/?hub_join=<userId>`. The hub turns that into a **`join`
  launch** with `launch.room` = your presence `room`, or tells the player "That game
  already started" if the lobby is gone. Keep `openSeats` and `joinable` honest, and
  set `joinable: false` the moment the match starts.

---

## 6. The launch contract

A **launch** is the hub bringing a player into your game for a reason: an invite was
sent or accepted, a friend tapped Join or Watch, or a `lobby_open` notification was
tapped.

```ts
interface Launch {
  kind: 'host' | 'guest' | 'join' | 'watch';
  game: string; mode?: string;
  partyId?: string; party?: Party; joinInfo?: Record<string, string> | null;  // invites
  room?: string;                                                              // join / watch
  host?: PlayerLite;     // guest: who invited you
  target?: PlayerLite;   // join / watch: whose room
}
```

| `kind` | When | What your game does |
|---|---|---|
| `host` | **I** sent an invite (from the hub UI or `hub.mp.invite`) | Show the lobby and **create the room** for party `partyId` (or share the room you're already in). |
| `guest` | I **accepted** an invite | Show the lobby. Join `joinInfo` if it's already there, otherwise wait for `hub.mp.onJoinInfo`. |
| `join` | I tapped **Join** on a friend, or a `lobby_open` notification | Join `launch.room`. |
| `watch` | I tapped **Watch** | Join `launch.room` as a spectator. |

**How players arrive:**
- **From another game or the catalog,** the hub navigates to `/<slug>/<lobby>` with a
  single-use `hub_launch=<token>` (2 minutes, stripped from the URL on load). The runtime
  redeems it and fires `onLaunch`.
- **Already in your game,** the launch fires **in place** with no reload. Your
  handler must cope with being in a menu, a lobby or an existing room.

**Rules:**

1. **Register `hub.mp.onLaunch` at boot, synchronously, before any `await`.** Launches
   that arrive before you register are buffered and delivered when you do. If a
   multiplayer game hasn't registered within **8 seconds** of a launch arriving, the
   player sees "This game didn't open its lobby", which counts as a bug in your game.
2. **Open the lobby URL.** When the page loads with your `lobby` suffix (e.g.
   `?mp=lobby`), go straight to the lobby screen, not the title screen.
3. **Make the handler idempotent.** A second invite reuses the same party and fires
   another `host` launch, and a guest may get both `launch.joinInfo` and a later
   `onJoinInfo`. Guard with "already in a room / already joining".
4. **Leave guard:** call `hub.mp.setBusy(true, { label: 'a match' })` when a live online
   match starts and `setBusy(false)` when it ends. While busy, any navigation the hub
   starts (accepting an invite, Join, switching games or going Home from the menu) first
   asks "Leave your match? You're in a match. Leaving now may end it for everyone."
   The label reads as a noun phrase after "You're in ...". Busy also makes overlay
   events report `canPause: false`.

```ts
hub.mp.onLaunch((l) => { void handleLaunch(l); });          // at boot, first thing
hub.mp.onJoinInfo(({ partyId, info }) => { if (info.room) void joinRoom(info.room); });
```

The full handlers are in the skeletons: [hub rooms §8](#skeleton-host-authoritative-hub-room-game)
and [own server §9](#client-side-own-server).

---

## 7. Invites & parties

- **Invite from your lobby** with the hub's friend picker (recommended):
  `hub.social.openInvite()`, or `hub.social.openInvite({ mode: 'ranked' })`. The picker
  lists online friends and calls the hub for you.
- **Your own friend list?** `await hub.social.friends()` returns `FriendEntry[]` (each
  `{id, username, avatar, presence, …}`). Call it once; after that
  `hub.social.on('friends', list => …)` hands you every change (presence included), so
  render from the event's list rather than calling `friends()` again. And `hub.mp.invite(userId, { mode })` sends one.
  It rejects with `HubError` (`code`: `cannot_invite`, `party_full`, `already_member`,
  `not_supported`, `bad_mode`, `rate_limited`, `claim_required`). Show `err.message`.
- **What happens:** the inviter gets a "waiting…" chip and a **`host` launch** (in place).
  The invitee gets a toast with Accept/Decline. Accept leads to a **`guest` launch** in
  your lobby. Decline, expiry (2 min) and cancel tell the inviter "can't play right now",
  and nobody navigates.
- **Parties:** an invite creates (or reuses) the inviter's **party** for your game: 2..`players[1]`
  friends (≤8) who move between games together. `launch.party` / `hub.mp.party()` give
  `{id, game, mode, leaderId, members, joinInfo}`. Subscribe with
  `hub.social.on('party', p => …)`. The leader role passes on when the leader leaves,
  and empty or 2-hour-idle parties dissolve.
- **Join info:** the party leader publishes where to connect with
  `hub.mp.setJoinInfo(partyId, { room: code })` (≤8 keys, values ≤64 chars). Every member
  gets `hub.mp.onJoinInfo({partyId, info})`. **Hub-rooms games get this for free:**
  `hub.rooms.create({ partyId })` from the leader sets `{room: code}` automatically.
- **"Play again"** keeps the party: create a new room with the same `partyId` (or
  `setJoinInfo` with the new code), and members follow `onJoinInfo`.
- Guests can't invite or be invited. They join by room code or public list.

---

## 8. Hub rooms (no server)

The hub relays messages and holds a small shared state. **The host player's browser
runs the rules** (or every client does, in `relay` mode). There's no server code in
your game.

### API

```ts
// create / join / list
const room = await hub.rooms.create({ mode?, public?: false, maxPlayers?, model?: 'host', partyId? });
const room = await hub.rooms.join(codeOrId, { spectate?: false });   // 5-char code like 'K7QPA', or room.info.id
const rooms: RoomInfo[] = await hub.rooms.list({ mode? });           // public rooms in the lobby phase, this game

// the room handle (HubRoom)
room.info      // RoomInfo: { id, code, game, mode?, hostId, public, phase: 'lobby'|'playing'|'ended',
               //   maxPlayers, model: 'host'|'relay', seats: RoomSeat[], spectators, chatMode: 'on'|'quick'|'off' }
room.state     // shared state object (≤32 KB)
room.me        // { userId, host: boolean, spectator: boolean }

room.on('room', (info: RoomInfo) => …)               // roster / ready / phase / host changed
room.on('state', (state) => …)                       // shared state changed (the full merged object)
room.on('msg', ({ from, data, seq, to }) => …)       // a relayed game message (`to` set when addressed to one seat)
room.on('chat', ({ from, text, quick }) => …)        // a moderated chat line (yours too)
room.on('abandoned', ({ userId, reason }) => …)      // a seat's grace ran out mid-match
room.on('kicked', ({ roomId }) => …)                 // you were kicked (banned for the room's lifetime)
room.on('ended', ({ room, results }) => …)           // once: the host ended the match; results = what it passed to end()
room.on('closed', ({ reason }) => …)                 // 'empty'|'ended'|'host_left'|'other_tab'|'moved'|'removed'|'gone'

await room.ready(true);                  // lobby ready flag
await room.seat({ color: 'teal' });      // your seat's data (≤2 KB, game data only, never player text)
await room.start();                      // host: lobby → playing
await room.send(data, { to? });          // a game message (≤8 KB, ≤30/s per seat)
await room.setState(patch, { replace? });// host (or anyone in relay model): shallow-merge; null deletes a key
const shown = await room.chat(text);     // moderated free text → the delivered (maybe softened) text
await room.quick('gg');                  // a quick-chat phrase id
await room.kick(userId);                 // host only
await room.end(results?);                // host: playing → ended; records "recent players"
await room.leave();
```

All methods reject with `HubError` / `ContentRejectedError` / `OfflineError`.

| Error `code` | When |
|---|---|
| `room_not_found` (404) | Unknown or ended room, or someone in it blocked you (indistinguishable on purpose). |
| `room_full`, `in_progress` (409) | New seats only exist in the lobby phase, up to `maxPlayers`. |
| `banned` (403) | You were kicked from this room. |
| `not_ready` (409) | `start()` needs ≥ `players[0]` seats and every other seat ready and connected. |
| `content_rejected` (422) | `chat()` refused: see [§10](#10-chat-in-your-game). |
| `suspended` (403) | The account is suspended. Show "Online play isn't available" and stay single-player. |

### Message models

| `model` | `send()` without `to` | Use for |
|---|---|---|
| **`host`** (default) | A guest's message goes to the **host only**. The host's message goes to **everyone else**. | Host-authoritative: guests send intents, the host validates them and publishes state. |
| **`relay`** | Goes to **everyone, including the sender**, in one ordered stream (`seq`). Anyone may `setState`. | Deterministic games where every client applies the same ordered inputs. |

`send(data, { to: userId })` addresses one seat in either model. Spectators receive
unaddressed messages and state only, and can't send.

### State vs messages

- **`setState`** is for **truth that late joiners need**: the board, scores, whose turn
  it is, the phase of your round. It's replayed to anyone who joins or reconnects. Keep
  it small (≤32 KB total) and patch it: `setState({ turn: 2 })` merges, and
  `setState({ ghost: null })` deletes `ghost`.
- **`send`** is for **events**: intents ("I clicked", "move left"), effects, pings. The
  last 200 messages are replayed on rejoin, filtered to what that seat could see.
- Never put player-typed text in either.

### Lobby, reconnect, spectators, ending

- **Lobby:** seats are `{userId, name, avatar, ready, connected, data?}`. The host
  migrates to the longest-seated player if the host leaves **before** start. If the host
  leaves **while playing**, the room closes with `host_left`.
- **Socket drops** (wifi blip, laptop sleep) are handled for you: the runtime
  reconnects and re-joins, your seat is reclaimed and you get current state plus the
  messages you missed. The seat shows `connected: false` meanwhile, and is held **30 s
  while playing** and **10 s in the lobby**. If the seat can't be reclaimed (the grace
  ran out, the room closed, or the host restarted), the room fires `closed` with reason
  `gone`.
- **Page reloads are yours to handle:** the room isn't re-adopted automatically. Keep
  the code in `sessionStorage` and call `hub.rooms.join(code)` at boot. Your seat is
  keyed by user id, so any tab or device reclaims it. A second tab taking the seat
  closes the first with `other_tab`.
- **Abandoned:** when a dropped seat's grace runs out mid-match (or a player leaves or
  is kicked), everyone gets `abandoned {userId}`. The host decides: an AI takes the seat
  (preferred), or the player forfeits.
- **Empty rooms** close after 2 minutes, and **ended rooms** 2 minutes after `end()`.
- **Spectators** (`multiplayer.spectate`) get state and broadcasts, can't chat or send,
  and are capped at 20.
- **Ending:** the host calls `room.end(results)`. Every seated player becomes a "recent
  player" of the others (so they can friend each other). Results are **untrusted**: the
  hub writes no stats or boards from them. Every client (the host too) gets them once
  in the room's **`ended`** event (`room.on('ended', ({ results }) => showResults(results))`),
  so there is no need to copy them into state first.
  Each client may record its **own** stats with `hub.incrStat` (honor system, like
  single-player).
- **Limits:** 8 seats, 30 msgs/s per seat, 8 KB per message, 32 KB state, 200 open rooms
  per game. Guests may create and join rooms.

### Skeleton: host-authoritative hub-room game

Drop-in shape for a static game (TypeScript, dg-template). The `apps-test/mpdemo` app
in the hub repo is the complete runnable reference.

```ts
import { hub, ContentRejectedError, type HubRoom, type Launch, type RoomInfo } from './hub/hub';

type Intent = { type: 'move'; dx: number; dy: number };          // guest → host
type GameState = { players: Record<string, { x: number; y: number }>; turn: number; results?: unknown };

let room: HubRoom | null = null;
let joining: Promise<void> | null = null;
const ROOM_KEY = `${hub.slug}:room`;

// --- boot (synchronous: register before any await) ---------------------------
hub.overlay.autoPause({ pause: () => showPauseScreen() });
hub.mp.onLaunch((l) => { void handleLaunch(l); });
hub.mp.onJoinInfo(({ info }) => { if (info.room) void enterBy(() => hub.rooms.join(info.room)); });
if (new URLSearchParams(location.search).has('mp')) showLobby();          // our `lobby: "?mp=lobby"`
const saved = sessionStorage.getItem(ROOM_KEY);                            // reload mid-match → reclaim seat
if (saved) void enterBy(() => hub.rooms.join(saved)).catch(() => sessionStorage.removeItem(ROOM_KEY));

async function handleLaunch(l: Launch): Promise<void> {
  showLobby();
  if (room) {                                     // already in a room: share it with the (new) party
    if (l.kind === 'host' && l.partyId) await hub.mp.setJoinInfo(l.partyId, { room: room.info.code });
    return;
  }
  if (l.kind === 'host') return enterBy(() => hub.rooms.create({ partyId: l.partyId, mode: l.mode, maxPlayers: 4 }));
  if (l.kind === 'guest') return l.joinInfo?.room
    ? enterBy(() => hub.rooms.join(l.joinInfo!.room))
    : showWaiting(`Waiting for ${l.host?.username ?? 'the host'}…`);   // onJoinInfo follows
  if (l.kind === 'join' && l.room) return enterBy(() => hub.rooms.join(l.room!));
  if (l.kind === 'watch' && l.room) return enterBy(() => hub.rooms.join(l.room!, { spectate: true }));
}

/** One room at a time; concurrent launch/joinInfo calls share the same attempt. */
function enterBy(open: () => Promise<HubRoom>): Promise<void> {
  if (room) return Promise.resolve();
  joining ??= open().then(enter, (e) => showError(e)).finally(() => { joining = null; });
  return joining;
}

// --- lobby buttons ------------------------------------------------------------
createPublicBtn.onclick = () => enterBy(() => hub.rooms.create({ public: true, maxPlayers: 4 }));
inviteBtn.onclick = () => hub.social.openInvite();
bellBtn.onclick = () => hub.social.openNotify({ game: hub.slug ?? undefined });
readyBtn.onclick = () => room?.ready(!mySeat()?.ready).catch(showError);
startBtn.onclick = () => room?.start().catch(showError);            // host only

// --- the room -----------------------------------------------------------------
function enter(r: HubRoom): void {
  room = r;
  sessionStorage.setItem(ROOM_KEY, r.info.code);
  r.on('room', onRoom);
  r.on('state', (s) => render(s as GameState));
  r.on('msg', ({ from, data }) => { if (r.me.host) applyIntent(from, data as Intent); });
  r.on('chat', addChatLine);                                       // see §10
  r.on('abandoned', ({ userId }) => { if (r.me.host) aiTakeOver(userId); });
  r.on('kicked', () => left('You were removed from the room.'));
  r.on('ended', ({ results }) => showResults(results));             // once, on every client
  r.on('closed', ({ reason }) => left(reason === 'host_left' ? 'The host left.' : 'The room closed.'));
  onRoom(r.info);
  render(r.state as GameState);
}

function onRoom(info: RoomInfo): void {
  const me = room!.me;
  hub.mp.setBusy(info.phase === 'playing' && !me.spectator, { label: 'a match' });
  hub.notify.setQuiet(info.phase === 'playing');
  const openSeats = Math.max(0, info.maxPlayers - info.seats.length);
  hub.presence.set(info.phase === 'playing'
    ? { kind: me.spectator ? 'watching' : 'playing', detail: `Duel · ${info.seats.length} players`, joinable: false, watchable: true }
    : { kind: 'lobby', detail: 'Waiting for players', joinable: openSeats > 0, public: info.public, openSeats });
  if (info.phase === 'playing' && me.host && !room!.state.players) {
    void room!.setState({ players: {}, turn: 0 } satisfies GameState);   // host seeds the truth once
  }
  renderLobby(info);   // names: render with textContent + hub.social.openPlayer (§11)
}

// Guests send intents; the host validates and publishes the truth.
function sendMove(dx: number, dy: number): void {
  if (!room || room.me.spectator) return;
  if (room.me.host) applyIntent(room.me.userId, { type: 'move', dx, dy });
  else void room.send({ type: 'move', dx, dy } satisfies Intent).catch(showError);
}

function applyIntent(from: number, i: Intent): void {
  const s = room!.state as GameState;
  if (i?.type !== 'move' || !s.players) return;                     // validate everything a guest sends
  const p = s.players[from] ?? { x: 0, y: 0 };
  const next = { x: clamp(p.x + Math.sign(i.dx), 0, 9), y: clamp(p.y + Math.sign(i.dy), 0, 9) };
  void room!.setState({ players: { ...s.players, [from]: next }, turn: s.turn + 1 });
}

async function finish(results: unknown): Promise<void> {           // host
  await room!.end(results);                                         // everyone gets them in 'ended'
}

function left(message: string): void {
  room = null;
  sessionStorage.removeItem(ROOM_KEY);
  hub.mp.setBusy(false);
  hub.notify.setQuiet(false);
  hub.presence.set({ kind: 'lobby', detail: 'Picking a room' });
  showLobby(message);
}
```

(`showLobby`, `render`, `renderLobby`, `showError`, `aiTakeOver`, `mySeat`, `clamp`… are yours.)

---

## 9. Own-server games

Use this when your server must be the authority ([§1](#1-do-i-need-multiplayer-choosing-a-transport)).
You keep your own netcode. The hub supplies verified identity, presence, invites,
kid-safe chat and trusted results.

### Setup

1. **Process app.** The game block is `type: "process"` with a `start` command that
   binds `PORT`. See the host's `HANDOFF.md` (process-app contract, path handling).
   The host proxies HTTP **and WebSockets** under `/<slug>/` with the prefix stripped,
   so `/<slug>/ws` reaches your server as `/ws`.
2. **Vendor the server SDK:** copy the hub's `clients/server/hub-server.mjs` to
   `server/hub-server.mjs`. `npm run sync-hub` does this when your game has a `server/`
   directory. It's also served at `/_hub/hub-server.mjs`. It has zero dependencies.
3. **Env:** the host injects `GAME_SLUG`, `HUB_URL` (the hub's loopback URL) and
   `HUB_APP_KEY` (your game's private key) into hub-enabled process apps. Without them
   (local dev with no hub), `createHubServer().enabled` is `false` and every call
   degrades: `verifyTicket` gives `null`, `chat` gives `{ok:false, err:{reason:'check_unavailable'}}`
   and `results`/`recent` give `{ok:false, error}`. **Nothing throws.**

```jsonc
"game": {
  "type": "process",
  "title": "Rally Duel",
  "build": "npm run build",
  "start": "node server/index.mjs",
  "healthPath": "/",
  "multiplayer": { "lobby": "?mp=lobby", "players": [2, 2], "transport": "own-server", "spectate": true },
  "leaderboards": [{ "key": "best-rally", "title": "Best Rally", "sort": "desc", "source": "server" }]
}
```

### Tickets (verified identity)

- The browser calls `await hub.mp.ticket()` and sends the result in its first message.
  It's valid for **60 seconds** and for **your slug only**, so fetch a fresh one on
  every (re)connect.
- The server checks it **offline** (an HMAC, no network call) with
  `hub.verifyTicket(t)`, which returns `{uid, name, avatar, guest, slug, exp, n}` or `null`.
- **`uid` is the player's hub user id.** Key seats, reconnects and results by it.
  `name` is their filtered hub username, so display it, never a typed name.
- Guests get tickets too (`guest: true`). Suspended players don't: `ticket()` rejects
  with `code:'suspended'`.

### `hub-server.mjs`

```js
import { createHubServer } from './hub-server.mjs';
const hub = createHubServer();       // { slug, key, url, fetch } default from env

hub.enabled                          // false without the hub env (local dev)
hub.verifyTicket(ticket)             // → { uid, name, avatar, guest, slug, exp, n } | null
await hub.chat({ userId, text, members, context })   // or { userId, quick, members }
  // → { ok: true, text, quick?, softened? } | { ok: false, err: { error, code, reason, hint?, retryAfterMs? } }
await hub.results({ room, mode, players: [{ userId, place, won, stats, scores }] })   // → { ok } | { ok:false, error }
await hub.recent([uidA, uidB])       // "played together" (so they can friend each other) → { ok }
```

- **`chat`:** `members` are the uids who would see the line. Free text is allowed only
  when everyone in `[userId, ...members]` is a mutual friend (and nobody is
  parent-locked or muted). Otherwise send `quick` ids. Your `chatAllow` applies.
  **Relay `result.text`, never the original.** `context` (optional, ≤6
  `{from:'me'|'them', text}`) helps the AI reviewer.
- **`results`** is trusted, posted from your server only. For each listed player it adds
  1 to the `online_games` stat (and to `online_wins` when `won`), increments every
  `stats` key, writes `scores` to your **server-source** boards (best-only, like
  `submitScore`), records recent players and logs the match. ≤16 players, ≤32 keys,
  keys `[A-Za-z0-9_.:-]`, finite numbers. `room`/`mode` ≤64 safe chars, `place` 1–64.
  Unknown user ids are skipped.
- **Server-source boards:** declare `"source": "server"` on a `game.leaderboards` entry.
  The browser's `hub.submitScore` to that board is refused (403). Only `results().scores`
  write it. That makes the board cheat-resistant.
- The internal API answers only loopback calls with no `x-forwarded-for` and your
  `x-hub-app`/`x-hub-key`. Anything else gets a 404.

### Client side (own server)

```ts
import { hub, type Launch } from './hub/hub';

let ws: WebSocket | null = null;
let roomCode: string | null = sessionStorage.getItem('room');
let tries = 0;

hub.overlay.autoPause({ pause: () => showPauseScreen() });
hub.mp.onLaunch((l) => { void onLaunch(l); });
hub.mp.onJoinInfo(({ info }) => { if (info.code && !roomCode) join(info.code); });

async function onLaunch(l: Launch): Promise<void> {
  showLobby();
  if (l.kind === 'host') {                     // create on our server, then tell the party where
    const code = roomCode ?? await createRoomOnServer(l.mode);
    if (l.partyId) await hub.mp.setJoinInfo(l.partyId, { code });
  } else if (l.kind === 'guest') {
    if (l.joinInfo?.code) join(l.joinInfo.code);                  // else onJoinInfo follows
  } else if (l.room) {
    join(l.room, l.kind === 'watch');                             // our presence `room` = our code
  }
}

async function connect(): Promise<void> {
  const url = new URL('ws', location.href);                        // → /<slug>/ws (relative!)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ticket = await hub.mp.ticket().catch(() => null);          // fresh every connect (60 s)
  ws = new WebSocket(url);
  ws.onopen = () => { tries = 0; ws!.send(JSON.stringify({ t: 'hello', ticket, room: roomCode })); };
  ws.onmessage = (e) => onServer(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (e.code === 4401) return showError('Please sign in again.');
    const wait = Math.min(8000, 500 * 2 ** tries++) * (0.75 + Math.random() / 2);   // 0.5 s → 8 s, jittered
    showReconnecting();
    setTimeout(connect, wait);
  };
}
// In onServer(): on 'joined' → sessionStorage.setItem('room', code) and
// hub.presence.set({ kind: 'lobby', room: code, joinable, public, openSeats });
// on 'start' → hub.mp.setBusy(true, { label: 'a match' }); on 'end' → setBusy(false).
```

### Server skeleton (`server/index.mjs`)

Static files plus a `ws` server (add `ws` to `dependencies`). Seats are keyed by hub
uid, with a reconnect grace (the pattern 8 Ball Pool uses).

```js
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHubServer } from './hub-server.mjs';

const hub = createHubServer();
const GRACE_MS = 30_000;
const rooms = new Map();   // code → { code, hostUid, phase, seats: Map<uid, Seat> }
// Seat = { uid, name, ws, connected, graceTimer }

const http = createServer(serveDist);                   // your static dist/ handler
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let me = null;   // { uid, name, guest }
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return ws.close(4400); }
    if (!me) {
      if (m.t !== 'hello') return ws.close(4400);
      const p = hub.verifyTicket(m.ticket);
      if (p) me = { uid: p.uid, name: p.name, guest: p.guest };
      else if (!hub.enabled) me = { uid: -Math.ceil(Math.random() * 1e9), name: 'Dev', guest: true };  // local dev only
      else return ws.close(4401, 'bad ticket');
      if (m.room) rejoin(m.room, me, ws);
      return;
    }
    const room = roomOf(me.uid);
    switch (m.t) {
      case 'create': return createRoom(me, ws, m.mode);
      case 'join':   return joinRoom(m.code, me, ws, m.watch === true);
      case 'input':  return room && applyInput(room, me.uid, m);   // validate EVERYTHING
      case 'chat': {
        if (!room) return;
        const members = [...room.seats.keys()].filter((u) => u !== me.uid && u > 0);
        const c = await hub.chat({ userId: me.uid, text: m.text, quick: m.quick, members });
        if (c.ok) broadcast(room, { t: 'chat', from: me.uid, text: c.text, quick: c.quick });
        else ws.send(JSON.stringify({ t: 'chat_rejected', id: m.id, ...c.err }));  // {error, code, reason, hint, retryAfterMs}
        return;
      }
    }
  });
  ws.on('close', () => {
    const room = me && roomOf(me.uid);
    const seat = room?.seats.get(me.uid);
    if (!seat || seat.ws !== ws) return;               // an older socket of a reclaimed seat
    seat.connected = false;
    broadcast(room, { t: 'seat', uid: me.uid, connected: false });
    seat.graceTimer = setTimeout(() => abandon(room, me.uid), GRACE_MS);   // AI takeover or forfeit
  });
});

function rejoin(code, me, ws) {
  const seat = rooms.get(code)?.seats.get(me.uid);
  if (!seat) return ws.send(JSON.stringify({ t: 'gone', code }));
  clearTimeout(seat.graceTimer);
  if (seat.ws && seat.ws !== ws) seat.ws.close(4000, 'other tab');
  Object.assign(seat, { ws, connected: true });
  ws.send(JSON.stringify({ t: 'snapshot', state: snapshotOf(rooms.get(code)) }));   // full catch-up
}

async function endMatch(room, placings) {              // placings: [{ uid, place, won, rally }]
  broadcast(room, { t: 'end', placings });
  const real = placings.filter((p) => p.uid > 0);
  await hub.results({
    room: room.code, mode: 'duel',
    players: real.map((p) => ({ userId: p.uid, place: p.place, won: p.won, stats: { rallies: p.rally }, scores: { 'best-rally': p.rally } })),
  });                                                   // also records recent players
}

http.listen(Number(process.env.PORT), '127.0.0.1');
```

- **Presence and Join/Watch:** the hub has no "publish room" call. The **client** reports
  `hub.presence.set({ kind: 'lobby', room: code, joinable, public, openSeats })`, and a
  friend's Join arrives as a `join` launch with `launch.room = code`. Set `joinable: false`
  once the match starts, and `watchable: true` if you support spectators.
- **Reconnect rules:** keep the seat for the grace window, accept the same `uid` from
  any socket, close the older socket, and send a full snapshot. The client backs off
  0.5 s → 8 s with jitter, with a fresh ticket each time. Show "Reconnecting…" rather
  than ending the match.
- **Ratings/Elo** aren't built yet. Use `stats` and server-source boards.

---

## 10. Chat in your game

**Never roll your own text channel.** Use `room.chat` / `room.quick` (hub rooms) or
`hub.chat()` on your server. The hub filters every line *before* anyone sees it: word
lists, personal-info and link detectors, spam and caps checks, an optional AI reviewer,
strikes and mutes.

### Who may type

The effective **chat mode** is the strictest of these:

| Mode | Meaning | Your UI |
|---|---|---|
| `on` | Everyone present is a **mutual friend** of everyone else, all claimed, nobody parent-locked or muted, and the site allows it | text box **and** quick-chat chips |
| `quick` | Anyone else (strangers, guests, a parent-locked player, a muted sender, site in `HUB_CHAT=quick`) | **quick-chat chips only**, with the tooltip "Typing is only for when everyone here is friends." |
| `off` | Site chat switched off (`HUB_CHAT=off` or the admin switch) | hide chat. Optionally show "Chat is turned off right now." |

- **Hub rooms:** use `room.info.chatMode` (authoritative, updated with every `room`
  event).
- **Own server or elsewhere:** `hub.social.chatMode(otherUserIds)` is a client-side
  estimate (`'off'` until the runtime loads). It's conservative: `'on'` only for a
  one-to-one conversation with a friend — a group of three or more starts at `'quick'`,
  because a client can't see whether *other* players are friends with each other. The
  server's `hub.chat()` result is final: free text in a quick-only room is refused with
  `reason: 'not_friends'` (DMs use `'quick_only'`). Treat both as "switch this chat to
  chips".
- **Hub-room spectators** can't chat. An own-server game may let spectators chat, but
  every line still goes through `hub.chat()` with the spectators included in `members`.

### Quick-chat phrases & emotes

Phrases travel as **ids** and every client renders them from the id:

- **Hub phrases (stable ids):** `hi` Hi! · `gg` Good game! · `gl` Good luck! · `nice` Nice one! ·
  `wow` Wow! · `thanks` Thanks! · `yw` You're welcome! · `oops` Oops! · `sorry` Sorry! ·
  `ready` I'm ready! · `wait` Wait for me! · `brb` Be right back · `back` I'm back! ·
  `go` Let's go! · `rematch` Rematch? · `play` Want to play? · `yes` Yes · `no` No ·
  `maybe` Maybe · `fun` That was fun! · `help` Help me! · `follow` Follow me! · `bye` Bye! ·
  `later` See you later!
- **Emotes:** `e:😀` `e:😂` `e:😮` `e:😢` `e:😎` `e:🤔` `e:👍` `e:👏` `e:🎉` `e:❤️` `e:🔥` `e:⭐`
- **Your phrases:** `game.multiplayer.quickChat[i]` becomes `g:<slug>:<i>`.
- The full id → text map is in `GET /_api/social/config` (`quickChat`). Fetch it once,
  or hard-code your chosen subset.
- Pick 6–10 chips that fit your game. Room chat accepts hub phrases, emotes and **your**
  game's phrases.

### Sending and rendering

```ts
async function sendChat(input: HTMLInputElement, sendBtn: HTMLButtonElement): Promise<void> {
  const text = input.value.trim();
  if (!room || !text) return;
  sendBtn.disabled = true; chatStatus.textContent = 'checking…';      // usually < 1 s
  try {
    const shown = await room.chat(text);                          // the delivered text
    input.value = '';                                             // clear ONLY on success
    chatStatus.textContent = shown !== text ? 'Some words were swapped for friendlier ones ✨' : '';
  } catch (e) {
    if (!(e instanceof ContentRejectedError)) { chatStatus.textContent = "Couldn't send — try again."; return; }
    chatStatus.textContent = e.hint ?? "That message can't be sent.";  // keep the draft in the box
    shake(input);
    if (e.retryAfterMs) disableFor(sendBtn, e.retryAfterMs);      // muted / rate_limited: countdown
  } finally {
    if (!sendBtn.dataset.cooldown) sendBtn.disabled = false;
  }
}

// In enter(r): lines arrive for everyone, including the sender, AFTER moderation.
r.on('chat', ({ from, text, quick }) => {
  const line = document.createElement('div');
  line.textContent = `${nameOf(from)}: ${text || quickText(quick)}`;   // textContent, never innerHTML
  chatLog.append(line);
});
```

- **Render only what the hub delivered.** Use the `chat` event (or your server's
  broadcast of `result.text`), never the input value.
- **Rejections** (`ContentRejectedError`, HTTP 422 / a WS ack `content_rejected`):
  keep the draft, shake the input, and show `hint` under it in your danger colour.
  **Never say which word matched**, and don't invent your own wording when `hint` exists.
- `reason` is one of: `link`, `personal_info`, `contact`, `language`, `slur`, `sexual`,
  `grown_up`, `unkind`, `threat`, `drugs`, `spam`, `shouting`, `too_long`, `empty`,
  `chars`, `rate_limited`, `muted`, `check_unavailable`, `chat_off`, `quick_only`,
  `suspended`.
  - `muted` and `rate_limited` carry `retryAfterMs`: show a countdown, keep the chips working.
  - `check_unavailable` means the safety check is down. Keep the draft and offer a retry.
    Quick-chat still works.
- **Softened text:** game-violence words are rewritten, not rejected ("I got shot" →
  "I took damage", "bomb" → "confetti cannon"). The sender sees the softened version
  too. Show the ✨ hint once. Use `chatAllow` if your game genuinely needs a word like
  "shot" (pool).
- **Limits:** room chat ≤120 chars, at most 4 messages per 5 s. Quick-chat counts toward
  the rate too.
- **Own-server rejections:** relay the `err` object to the sender and render it the
  same way: `hint`, keep the draft, honour `retryAfterMs`.

### Copy rules for your own UI

- **No violent words** in buttons, toasts, quick-chat or presence: "zap", "tag", "pop",
  "knock out", "out of HP". The `quickChat` and `detail` checks don't soften. A
  soften-list word there is rejected.
- No links, social handles, ages, schools or "add me on…" anywhere in game text.
- Player names come from the hub (`seat.name`, ticket `name`). Never let players type a
  name that others will see. The hub username is the name.

---

## 11. Showing other players · notification etiquette

**Every name you render opens the player card.** That's the friend/message/block/report
path, and kids need it one tap away:

```ts
function nameButton(seat: { userId: number; name: string }): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = seat.name;                                        // textContent: names are data
  b.onclick = () => hub.social.openPlayer({ userId: seat.userId }); // or { username }
  return b;
}
```

- Lobby rosters, scoreboards, chat lines, "X joined" messages and in-world name tags
  all get a card. Hub rooms give you `userId`, and own-server tickets give you `uid`.
- **Avatars:** `seat.avatar` / `PlayerLite.avatar` are preset ids (`a0`…`a23`). The hub
  shows them on its own UI. Show them in yours if you like.
- Other openers: `hub.social.openFriends()`, `openChat(userId)`,
  `openInvite({ userId?, mode? })`, `openSuggest()`, `openNotify({ game? })`. Live data:
  `hub.social.counts()` → `{ online, inGame, friendsOnline }` and
  `hub.social.on('friends' | 'presence' | 'counts' | 'invite' | 'party', cb)`.
  The same are mirrored as window events — `hub:friends`, `hub:presence`, `hub:invite`
  and `hub:launch` (every launch handed to `onLaunch`), with the payload in `e.detail` —
  for code that prefers `addEventListener`.
  A "● 12 playing" badge from `counts().inGame` makes a lobby feel alive.

**Notification etiquette:**

- `hub.notify.setQuiet(true)` during intense play. Toasts collapse into the menu-button
  badge; **invites still show** as a small non-blocking pill. Set it back to `false` on
  menus, pause screens and lobbies.
- `hub.menu.setVisible(false)` during play hides the button. Incoming messages then
  show a tiny corner pip instead of the wiggle. Show the menu again on pause.
- Don't make your own friend/online notifications. The hub's are opt-in and
  rate-limited.

---

## 12. Testing (required)

Every online game ships a **`tests/hub/`** suite that drives the hub test kit through
the scenarios below, and lists them in its README. Offline single-player games only
need scenario 5 (pausing).

### Required scenarios

1. **Invite → jump → accept → lobby:** A (in your game) invites B, who is in **another
   game** (`mpdemo`). B gets the toast and accepts. B lands in your lobby, and both
   `onLaunch`es fire with the right `kind` (`host` / `guest`) and the same `partyId`.
   Both end up in the same room.
2. **Decline, expiry and cancel** each notify the inviter, and nobody navigates.
3. **Leave guard:** B accepts an invite while A's match has `setBusy(true)`. The
   "Leave your match?" dialog appears, and **Stay** keeps the match.
4. **Join and Watch** from a friend's presence land in that room (Watch as a spectator,
   if you support it).
5. **Pause on hub open:** opening the hub menu fires overlay `open` and the game
   pauses. In an online match it keeps running (`canPause: false`). Closing behaves per
   your rule.
6. **Chat:**
   - a rejected message shows the hint and keeps the draft;
   - a softened word shows softened;
   - a room with a non-friend shows quick-chat only;
   - `HUB_CHAT=off` hides chat.
7. **Reconnect:** drop a player mid-match (reload / close and reopen the tab). The
   seat is held and reclaimed with current state.
8. **Suspended player** can't create, join or see the room, and the game shows a
   friendly message and stays playable offline.

Game-specific scenarios go on top (spectator joins mid-round, AI takeover after
`abandoned`, results reach a server-source board, …).

### The hub test kit

It lives in the hub repo (a sibling checkout, `../diffenderfer-games`), in
`test/helpers/`:

| Helper | What |
|---|---|
| `server.mjs` → `startHost({ apps, env, quiet })` | Boots a **real** host (`node src/index.js`) with `HUB_TEST=1`, a temp data dir, a temp apps dir (your dirs linked in) and a free port. Resolves to `{ url, port, dataDir, appsDir, logs, stop }`. It builds your game like production does. Pass `quiet: false` to see the log. |
| `server.mjs` → `MPDEMO_DIR` | The hidden demo game (`apps-test/mpdemo`): a second game to invite from or jump to, and the reference hub-rooms implementation. |
| `client.mjs` → `player(url, name)` / `guest(url)` | A claimed account (password `password1`) or a guest, as an `ApiClient` with its own cookie jar: `.get/.post/.put/.del(path, body)` → `{status, body}` (paths are under `/_api`), `.user`, and `.ws()` → a `/_ws` client (`op(name, d)`, `next(ev)`, `drain()`, `waitClose()`). |
| `client.mjs` → `befriend(a, b)` | Request + accept, so `a` and `b` are mutual friends. |
| `client.mjs` → `safeName(prefix)` | A unique, filter-safe username (letters only, since digit runs trip the username filter). |
| `apps.mjs` → `gameApps({ slug: gameFields })` | Throwaway static games with exactly the `game` block you need. |
| `apps.mjs` → `testAppKey(slug)` | The `HUB_APP_KEY` a test host gives `slug`, for calling `/_api/internal/*` yourself. |

**What `HUB_TEST=1` changes:**
- Rate limits are ×100. Delays and cooldowns are 0, so `lobby_open` is instant and
  presence has no grace.
- Any limit can be overridden with `env: { HUB_LIMITS_JSON: '{"roomGraceMs":500}' }`.
- The AI stage is a deterministic fake: text containing `[[block]]` is blocked and
  `[[aierror]]` simulates an outage.
- Web Push goes to an in-memory outbox.
- Loopback-only test routes are enabled:
  - `POST /_api/test/suspend {userId, ms}` / `POST /_api/test/unsuspend {userId}`
  - `GET /_api/test/alerts/:userId` (notifications raised, e.g. `lobby_open`)
  - `GET /_api/test/push/:userId` (the push outbox)
  - `POST /_api/test/reset-limits`
- `window.__HUB_TEST__` hooks: `lastLaunch`, `overlayLog` (`{ev, reason, canPause, at}[]`)
  and `toasts` (`{kind, title, body}[]`). They're filled when the page pre-defines
  `window.__HUB_TEST__ = {}` before load (`evaluateOnNewDocument`).

**Browser helpers:** the hub's own e2e suite has ready-made puppeteer helpers in
`test/e2e/helpers.mjs`:
- `e2eEnv({ apps })` + `e2e(name, env, fn)` (one host per file, screenshots on failure);
- `newPlayer(name, path)` / `newGuest(path)` (an isolated context each);
- `openHubMenu`, `deepFind` / `deepClick` (searches the hub's shadow roots by selector
  and text) and `waitForTestHook`.

Import them the same way as the kit (example below) to skip the boilerplate. The
hand-rolled version below shows what they do.

### Two-browser pattern (puppeteer-core)

Add `puppeteer-core` as a dev dependency. It drives the system Chrome (set
`CHROME_PATH`). Each player is a separate **browser context**, which means a separate
cookie jar and a separate account.

```js
// tests/hub/invite.test.mjs   —   node --test tests/hub/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const HUB = process.env.DG_HOST || resolve('..', 'diffenderfer-games');
const kit = (f) => import(pathToFileURL(resolve(HUB, 'test/helpers', f)).href);
const { startHost, MPDEMO_DIR } = await kit('server.mjs');
const { ApiClient, safeName } = await kit('client.mjs');
const SLUG = 'mygame';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let host, browser;
before(async () => {
  host = await startHost({ apps: { [SLUG]: process.cwd(), mpdemo: MPDEMO_DIR } });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
after(async () => { await browser?.close(); await host?.stop(); });

/** A signed-in player in their own browser context, on `path`. */
async function playerPage(path) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.evaluateOnNewDocument(() => { window.__HUB_TEST__ = {}; });
  await page.goto(`${host.url}/${path}`);
  const user = await page.evaluate(async (username) => {
    const r = await fetch('/_api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'password1' }) });
    return (await r.json()).user;
  }, safeName('Kid'));
  await page.reload();                       // the menu + socket pick up the account
  await ready(page);
  return { page, user };
}
/** The hub runtime is mounted and its socket has said hello (counts include me). */
const ready = (page) => page.waitForFunction(() => window.__HUB_RT__?.social.counts().online > 0, { timeout: 20_000 });
const api = (p, method, path, body) => p.page.evaluate(async (method, path, body) =>
  (await fetch('/_api' + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json(),
  method, path, body);
async function befriend(a, b) {
  await api(a, 'POST', '/social/friends', { userId: b.user.id });
  await api(b, 'POST', `/social/friends/${a.user.id}/accept`);
}
/** Click a hub-UI button by its label (hub UI lives in shadow roots). */
const clickHub = (page, label) => page.waitForFunction((label) => {
  const walk = (root) => [...root.querySelectorAll('*')].some((el) =>
    (el.tagName === 'BUTTON' && el.textContent.trim() === label && (el.click(), true)) || (el.shadowRoot && walk(el.shadowRoot)));
  return walk(document);
}, { timeout: 10_000 }, label);
const lastLaunch = (page, kind) => page.waitForFunction((k) => window.__HUB_TEST__?.lastLaunch?.kind === k, { timeout: 10_000 }, kind);

test('invite from my game reaches a friend in another game and both land in my lobby', async () => {
  const a = await playerPage(`${SLUG}/`);
  const b = await playerPage('mpdemo/');
  await befriend(a, b);
  await a.page.evaluate((id) => window.HubSDK.hub.mp.invite(id), b.user.id);
  await lastLaunch(a.page, 'host');                               // in place, no reload
  await Promise.all([b.page.waitForNavigation(), clickHub(b.page, 'Accept')]);   // the invite toast
  assert.match(b.page.url(), new RegExp(`/${SLUG}/`));
  await lastLaunch(b.page, 'guest');
  const [la, lb] = await Promise.all([a.page, b.page].map((p) => p.evaluate(() => window.__HUB_TEST__.lastLaunch)));
  assert.equal(la.partyId, lb.partyId);
  // …then assert through YOUR game's own test hook that both are in the same room.
});

test('opening the hub menu pauses the game', async () => {
  const a = await playerPage(`${SLUG}/`);
  await a.page.evaluate(() => document.querySelector('#hub-menu-root').shadowRoot.querySelector('.toggle').click());
  await a.page.waitForFunction(() => window.__HUB_TEST__.overlayLog.some((e) => e.ev === 'open' && e.reason === 'menu'));
  // …assert your game is paused (e.g. a tick counter stops).
});

test('a suspended player cannot use online play', async () => {
  const a = await playerPage(`${SLUG}/`);
  await new ApiClient(host.url).post('/test/suspend', { userId: a.user.id, ms: 60_000 });
  // REST calls and room ops fail fast with code 'suspended' (the socket was closed with 4003).
  const code = await a.page.evaluate(() => window.HubSDK.hub.mp.ticket().then(() => null, (e) => e.code));
  assert.equal(code, 'suspended');
  // …then click your "Play online" button and assert your friendly message, not a crash.
});
```

- **Chat scenarios:**
  - **link** (`visit example dot com`) → `reason: 'link'`, and the draft stays;
  - **soften** (`i got shot`) → the line shows "took damage";
  - **AI block** (`hello [[block]]`);
  - **non-friends** → `room.info.chatMode === 'quick'`;
  - **chat off:** a second host with `startHost({ apps, env: { HUB_CHAT: 'off' } })`.
- **Expiry:** `startHost({ env: { HUB_LIMITS_JSON: '{"inviteTtlMs":1500}' } })`.
- **Reconnect:** reload the page mid-match (or close it and `newPage()` in the same
  context). Use `HUB_LIMITS_JSON` `roomGraceMs` to test the abandoned path quickly.
- **REST/WS-only tests** (no browser) can use `player()` / `befriend()` / `.ws()`
  directly. The hub's own `test/api/rooms.test.mjs` and `mp.test.mjs` are worked
  examples.

### Manual testing

- Run the host locally with your game linked in:
  `cd ../diffenderfer-games && HUB_TEST=1 HOST_PORT=8099 node src/index.js` (symlink or
  junction your game into its `apps/<slug>`).
- Use **two browsers, or a normal and a private window**: two cookie jars, two
  accounts. Create two claimed accounts, friend them from the hub menu, and walk the
  scenarios. A phone on the LAN makes a good third player.

---

## Offline and no-hub behaviour

| Call | Without the runtime (offline, `hub:false`, `vite dev`) |
|---|---|
| `hub.overlay.*` | Fully works (local). `setBusy` still sets `canPause`. |
| `presence.set/clear`, `mp.setBusy`, `notify.setQuiet` | Remembered and replayed when the runtime appears. |
| `social.on`, `mp.onLaunch`, `mp.onJoinInfo` | Kept and attached whenever the runtime appears. They never expire. |
| `social.open*` | Wait up to 15 s, then do nothing. |
| `social.friends`, `mp.invite/ticket/setJoinInfo`, `rooms.*`, `race.create/join/list/finish/…` | Wait up to 15 s, then reject with `OfflineError` (immediately when the page isn't hub-injected). |
| `race.define`, `race.on` | Kept and attached whenever the runtime appears. `race.status` is dropped until then (there's no race without it). |
| `social.counts()` / `chatMode()` / `mp.party()` | Zeros / `'off'` / `null`. |

Guard every online entry point with a friendly "Online play needs a connection" when
it rejects with `OfflineError`, and keep single-player working.

---

## 13. Definition of done

Every game:

- [ ] `hub.overlay.autoPause({ pause })` is wired; opening the hub menu pauses the game,
      and closing it shows the pause screen (or resumes, for turn-based/idle games).
- [ ] `hub.presence.set` at natural screen changes (menu / playing / lobby).
- [ ] No violent words, links or contact info in UI copy, presence `detail` or `quickChat`.

Online games, additionally:

- [ ] `game.multiplayer` is declared with the correct `transport`; no warnings in the host log.
- [ ] `hub.mp.onLaunch` is registered at boot; `host` / `guest` / `join` / `watch` all land
      in the right room; the lobby URL opens the lobby; the handler is idempotent.
- [ ] Lobby has **Invite** (`hub.social.openInvite()`) and a 🔔 (`hub.social.openNotify({ game })`).
- [ ] Lobby presence reports `room` / `joinable` / `public` / `openSeats` honestly;
      `joinable: false` once playing.
- [ ] `hub.mp.setBusy(true)` during live matches (`false` after); the game keeps running
      when the menu opens mid-match.
- [ ] `hub.notify.setQuiet(true)` during intense play.
- [ ] Every rendered player name opens `hub.social.openPlayer`.
- [ ] Chat goes only through `room.chat` / `room.quick` / `hub.chat()`; lines render from
      delivered text only; rejections keep the draft and show `hint`; softened text shows the
      ✨ hint; `chatMode` drives text box vs chips vs hidden.
- [ ] No player-typed text crosses `send` / `setState` / your socket.
- [ ] Reconnect: socket drops and reloads reclaim the seat; `abandoned` is handled
      (AI or forfeit).
- [ ] Suspended / guest / offline players get a friendly message, never a crash.
- [ ] Own-server: tickets verified on the server (fresh ticket per connect); results via
      `hub.results()`; competitive boards are `"source": "server"`.
- [ ] `tests/hub/` covers the 8 required scenarios and passes against `startHost`.

---

## 14. Races (single-player games go multiplayer)

**Rule:** a single-player game (a puzzle, a level, a run) becomes multiplayer by
**racing**: everyone gets the **same** puzzle from a shared seed, the hub shows a
live race HUD, and **the first to finish wins**. Losing (game over, out of lives)
or giving up loses. You write no lobby, no netcode and no results screen.

| The hub does | Your game does |
|---|---|
| Open races list, join by code, invites, Join/Watch from presence, `lobby_open` | a **Race** button on the main menu + a param picker (difficulty, size…) |
| The waiting card (who's in, the 5-char code, Invite, Cancel) | `hub.race.create({ params })` |
| A fresh seed, revealed at the countdown; the 3-2-1-Go | build the puzzle from `seed` + `params` in `start()` |
| The live HUD (names → player cards, progress bars, your declared stats), Give up | `hub.race.status(stats, progress)` on every change |
| The referee (first valid finish wins; lose/forfeit/leave/drop = out) | `hub.race.finish(stats)` / `hub.race.lose(stats)` |
| The result card (Rematch, Done), the race history (drawer, player cards) | `exit()`: go back to your menu |

The full design, the wire contract and the trust limits are in the hub's
`docs/plans/race.md`. The reference game is the hub's `apps-test/racedemo`; the
first real one is The 15 Puzzle (`client/src/routes/Race.tsx`).

### 14.1 Declare `game.race`

```jsonc
"game": {
  "race": {
    "players": [2, 2],                    // [min, max] racers, within 2..8 (default [2, 2])
    "params": [                           // what the creator picks; the server only accepts these values
      { "key": "size", "title": "Board", "default": 4,
        "options": [{ "value": 3, "title": "3x3" }, { "value": 4, "title": "4x4" }] }
    ],
    "stats": [                            // what the HUD + history show (≤8; the HUD shows the first 3)
      { "key": "moves", "title": "Moves" },               // format: int (default) | percent | time | bool | color
      { "key": "pct", "title": "Done", "format": "percent" }
    ],
    "minMs": 3000,                        // a finish sooner than this after the go is held until it has passed
    "lobby": "?race=lobby"                // where race invites / Join land (default)
  }
}
```

- `race: true` is shorthand for all defaults (no params, no stats).
- A game with `race` but no `multiplayer` gets a race-only multiplayer block
  automatically (invites, Join, Watch). A game with both gets a `race` mode added
  to its modes; race invites and launches carry `mode: 'race'`.
- Titles are your text, shown to other players, so they're checked like
  quick-chat phrases (plain ASCII such as `3x3`, no violent words). A failing
  title falls back to its key (see the host log).
- Option values are numbers, booleans or short tokens (`[A-Za-z0-9_-]{1,24}`).

### 14.2 The game-facing API

```ts
hub.race.define({                          // at boot, once (works before the runtime loads)
  start(r) {                               // the countdown began (and again on rematch / after a reload)
    // r: { seed, params, startAt, round, players, roomId, resumed, spectator }
    newPuzzle(seededRng(r.seed), r.params); // SAME seed + params → SAME puzzle for everyone
    lockInputUntil(r.startAt);             // r.startAt is on this page's clock; the hub draws the 3-2-1
  },
  end(result) { stopInput(); },            // decided; the hub shows the result card
  exit() { showMainMenu(); },              // the player pressed Done / Cancel, or the race closed
  hud: { place: 'top' },                   // 'top' | 'bottom' | 'top-left' | … , or false to draw your own
});

startBtn.onclick = () => hub.race.create({ params: { size: 4 }, public: true });  // the hub shows the waiting card
joinBtn.onclick = () => hub.race.browse(); // the hub's "Open races" sheet (or render hub.race.list() yourself)
historyBtn.onclick = () => hub.race.openHistory();

hub.race.status({ moves, pct }, pct);      // on every change: throttled + coalesced by the hub (≤4/s)
await hub.race.finish({ moves, pct: 1 });  // → RaceResult if you won, null if someone beat you
await hub.race.lose({ moves });            // game over: you're out (the last racer still in wins)
await hub.race.forfeit();                  // give up (the HUD has a Give up button too)
hub.race.current();                        // RoomInfo (with .race) or null
hub.race.on('status' | 'start' | 'result' | 'room' | 'closed', cb);
await hub.race.history({ game, with });    // the signed-in player's races
```

- **Stats are numbers, booleans or `#rrggbb` colours, never text** (≤12 keys,
  identifier keys). Text would be a channel between strangers, so the server
  refuses it (`bad_stats`). The hub only renders stats you declared.
- **`progress`** (0..1) drives the HUD bars and places racers who didn't finish.
  Report it if you can (tiles home ÷ total, % of the level).
- **Race launches are the hub's.** An accepted race invite or a friend's Join
  lands on your `race.lobby` URL and the hub joins the race itself, so you don't
  need `hub.mp.onLaunch` for races (your non-race launches still arrive there).
  When your router redirects the lobby URL, **keep its query** (it carries
  `hub_launch` until the hub reads it).
- **Busy and quiet are automatic** while racing (the leave guard says "a race",
  toasts collapse). Don't pause the race when the hub menu opens: it can't wait.
- **Reloads:** the hub re-joins the race seat after a reload and calls `start()`
  again with `resumed: true` and the same seed. Restart the board, or restore the
  player's progress from your own `sessionStorage`.
- **Spectators** (friends who tap Watch) see the HUD; `start` isn't called for them.
- Guests can race (Open races, codes); invites need a claimed account.
  Suspended players can't race.

### 14.3 Fairness: same seed, same puzzle

Everything random about the puzzle must come from `r.seed` + `r.params`:

- Use a small seeded PRNG (e.g. mulberry32) for generation and **never**
  `Math.random()` in anything that changes the puzzle. Cosmetics may stay random.
- If the game already has a daily-challenge seed path, reuse it with the race seed.
- **Real-time games:** spawn timing, enemy AI and physics must be seeded and
  tick-based (fixed timestep), not frame-time based, or the two runs drift apart.
  When that's out of reach, race on the deterministic part (the same level
  layout) and say so in your docs.
- The seed is only revealed when the countdown starts, so nobody can pre-solve.

### 14.4 Trust

Reports come from the players' browsers. The hub measures time itself, holds
finishes until `minMs`, accepts one result per racer and only declared params,
and rate-limits status, but a determined cheater can still call `finish()`.
Races are for fun: they write the race history, never leaderboards or stats.
(Own-server games could verify finishes on their server later; see race.md.)

### 14.5 Testing

Use the hub test kit (§12) with your game linked into `startHost`, two players:
Race button → create → the other joins (Open races or code) → both `start()`s
got the same seed and built the same puzzle → a status reaches the other's HUD
(`#hub-social-layer >>> .so-hud`) → finish → "You won! 🏆" on one, "<name> won"
on the other → `hub.race.history()` has it. Plus Give up / lose → the other wins.
The hub's `test/e2e/race.test.mjs` and The 15 Puzzle's `tests/hub/race.test.mjs`
are worked examples. `HUB_LIMITS_JSON: '{"raceCountdownMs":1200}'` keeps tests quick.

**Race game definition of done:**

- [ ] `game.race` declared (params, stats, `minMs`); no registry warnings.
- [ ] A **Race** button on the main menu → a params picker → `hub.race.create`
      (plus `hub.race.browse()` / `openHistory()` buttons).
- [ ] `hub.race.define({ start, end, exit })` at boot; the puzzle comes from `seed` + `params` only.
- [ ] `status()` on every change (declared stats + progress); `finish()` / `lose()` at the end.
- [ ] Input locked until `startAt`, and after `end`.
- [ ] Works on a 390 px phone with the HUD showing (leave room at the top, or pick another `hud.place`).
- [ ] A `tests/hub/` race scenario (two players race; give up → the other wins).

