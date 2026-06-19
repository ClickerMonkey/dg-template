# Reactor Coolant Routing

A neon arcade puzzle for the **diffenderfer.games** catalog. You are stabilizing
a reactor: route charged **coolant cells** down the cooling **conduits** and feed
each **core** its element until every cell is routed and the reactor comes online.

Built on the TypeScript + [Vite](https://vitejs.dev) + [PixiJS v8](https://pixijs.com)
starter, with the shared **hub** client (cloud saves, stats, leaderboards, and
unified keyboard/mouse/touch/gamepad input) vendored in.

> Under the neon skin it is a faithful game of Klondike — the cooling rules map
> one-to-one onto descending-alternating tableau builds and ascending suit
> foundations — but the card grammar (suits, pips, faces, felt) and the classic
> row-of-seven layout are gone, so it reads as its own thing.

## How to play

- **Conduits (the 7 vertical rails)** cool by stepping **down in charge** with
  **alternating polarity** — a *hot* charge-7 cell only accepts a *cold* charge-6
  on top of it. An empty conduit only accepts a full charge-13 cell.
- **Cores (the 4 ringed discs)** each take one **element**, filled **upward 1 → 13**.
- **Feed battery** (top-left): tap **FEED** to draw the next cell(s) into the buffer.
  When the battery empties, tapping it recycles the buffer.
- **Win** when all 52 cells are routed into the cores.
- **Chain** core deliveries back-to-back to build a combo multiplier and output.

### Controls

| Action | Mouse / touch | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Move a cell / run | drag onto a conduit or core | cursor + ↑/↓/←/→ then **Enter** | d-pad + **A** |
| Route a cell to its core | **double-tap** the cell | select then **Enter** on the core | **A** |
| Draw from the feed | tap the battery / **FEED** | **F** | **X** |
| Auto-route everything safe | **AUTO** | **C** | **Y** |
| Undo / redo | **UNDO** | **Z** / **Y** | **LB** / **RB** |
| Hint | **HINT** | **H** | **RT** |
| New reactor / toggle draw-1↔3 | — | **N** / **M** | **Start** |

A focus cursor (cyan ring) appears when you use the keyboard or a gamepad; on a
conduit, ↑/↓ choose how deep into the face-up run you grab.

## Develop

```bash
npm install
npm run dev          # play locally (hub falls back to localStorage)
npm run build        # produces dist/  (what the catalog serves)
node scripts/make-cover.mjs   # regenerate cover.png
```

## Layout

```
src/
  main.ts     bootstrap: Pixi app, hub input, ticker, cloud saves & leaderboards
  engine.ts   pure game logic (Klondike rules), scoring/combo, save/undo
  view.ts     Pixi rendering, drag-and-drop + tap routing, gamepad/keyboard cursor
  theme.ts    colours + vector element glyphs
  hub/        vendored hub client (don't edit; re-copy to update)
```

## Hosting

Clone this beside the [diffenderfer-games](https://github.com/clickermonkey/diffenderfer-games)
host repo and symlink it into `apps/<slug>/`. The catalog runs `npm run build`
and serves `dist/` under `/<slug>/`.
