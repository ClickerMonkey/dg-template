/**
 * Reactor Coolant Routing — a neon arcade game that is, underneath, a faithful
 * game of Klondike. Route charged energy cells down the cooling conduits
 * (descending charge, alternating hot/cold polarity) and feed each reactor
 * core its element from 1 → 13. Clear every cell to bring the reactor online.
 *
 * Built on the diffenderfer.games starter: PixiJS v8 + the shared hub for
 * cloud saves, stats, leaderboards, and unified keyboard/touch/gamepad input.
 */
import { Application } from 'pixi.js';
import { hub } from './hub/hub';
import { Game, type State } from './engine';
import { BoardView } from './view';

const app = new Application();
await app.init({
  resizeTo: window,
  background: '#05070d',
  antialias: true,
  // Render at the device's pixel density so neon edges/text stay crisp on
  // high-DPI and mobile screens (capped for fill-rate sanity).
  resolution: Math.min(window.devicePixelRatio || 1, 3),
  autoDensity: true,
});
document.body.appendChild(app.canvas);

const game = new Game();
const board = new BoardView(app, game);

// ---------------------------------------------------------------------------
// Input — named inputs read the same on keyboard / gamepad / touch. Pointer
// drag-and-drop is handled inside the view; these drive the focus cursor and
// the global actions (draw, auto-route, undo, hint, new reactor).
// ---------------------------------------------------------------------------
hub.input.define({
  groups: {
    play: {
      inputs: {
        navLeft:  { keys: ['a', 'arrowleft'],  gamepad: { button: 14 } },
        navRight: { keys: ['d', 'arrowright'], gamepad: { button: 15 } },
        navUp:    { keys: ['w', 'arrowup'],    gamepad: { button: 12 } },
        navDown:  { keys: ['s', 'arrowdown'],  gamepad: { button: 13 } },
        act:      { keys: ['enter', ' '],      gamepad: { button: 0 } },
        cancel:   { keys: ['escape', 'backspace'], gamepad: { button: 1 } },
        draw:     { keys: ['f'],               gamepad: { button: 2 }, touch: { button: 'draw' } },
        auto:     { keys: ['c'],               gamepad: { button: 3 }, touch: { button: 'auto' } },
        undo:     { keys: ['z', 'u'],          gamepad: { button: 4 }, touch: { button: 'undo' } },
        redo:     { keys: ['y'],               gamepad: { button: 5 } },
        hint:     { keys: ['h'],               gamepad: { button: 7 }, touch: { button: 'hint' } },
        newgame:  { keys: ['n'],               gamepad: { button: 9 } },
        toggle:   { keys: ['m'] },
      },
      virtual: [
        { id: 'draw',  type: 'button', place: 'bottom-right', label: 'FEED', shape: 'round',  color: '#34c6ff' },
        { id: 'auto',  type: 'button', place: 'bottom-left',  label: 'AUTO', shape: 'round',  color: '#ffd24d' },
        { id: 'undo',  type: 'button', place: 'bottom-left',  label: 'UNDO', shape: 'round',  color: '#9fb4d8' },
        { id: 'hint',  type: 'button', place: 'bottom-left',  label: 'HINT', shape: 'round',  color: '#ffe14d' },
      ],
    },
  },
});
hub.input.enable('play');

// ---------------------------------------------------------------------------
// Saves / scores — offline-safe. We mirror the in-progress game to the cloud
// (debounced) and resume it at boot; on a win we post score + best time.
// ---------------------------------------------------------------------------
let saveTimer = 0;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    hub.putSave<State>('main', game.serialize()).catch(() => { /* offline → queued */ });
  }, 600);
}

let won = false;
async function onWin(): Promise<void> {
  if (won) return;
  won = true;
  const s = game.state;
  board.showToast('REACTOR ONLINE — coolant fully routed!', 9);
  try {
    hub.incrStat('wins', 1);
    hub.maxStat('high_score', s.score);
    hub.maxStat('best_combo', s.combo);
    await hub.submitScore('score', s.score, { title: 'Reactor Output', sort: 'desc' });
    await hub.submitScore('time', Math.round(s.time), { title: 'Fastest Stabilization', sort: 'asc', meta: { moves: s.moves } });
  } catch { /* offline → queued and synced later */ }
}

game.onChange = () => {
  board.reconcile(true);
  scheduleSave();
  if (game.state.won && !won) onWin();
};

// boot: resume a saved reactor if one exists & isn't already solved
(async () => {
  let resumed = false;
  try {
    const r = await hub.getSave<State>('main');
    if (r.save && !r.save.data.won && game.load(r.save.data)) {
      resumed = true;
      won = false;
      board.reconcile(false);
    }
  } catch { /* ignore — start fresh */ }
  if (!resumed) {
    game.newGame(1);
    won = false;
  }
  hub.incrStat('games', 1);
  board.showToast(
    resumed
      ? 'Reactor restored. Drag cells, double-tap to route, FEED to draw.'
      : 'Drag cells down the conduits (descending, alternating polarity). Double-tap routes to a core. Tap FEED to draw. [N] new · [M] draw mode · [H] hint',
    9,
  );
})();

// re-upload progress when the player signs in mid-session (don't pull)
window.addEventListener('hub:auth', (e: any) => {
  if (e.detail && e.detail.user) hub.putSave<State>('main', game.serialize()).catch(() => {});
});

// ---------------------------------------------------------------------------
// Main loop — read input edges, advance the timer, animate.
// ---------------------------------------------------------------------------
const I = hub.input;
let drawMode: 1 | 3 = 1;

app.ticker.add((ticker) => {
  // focus cursor
  if (I.down('navLeft')) board.cursorMove(-1);
  if (I.down('navRight')) board.cursorMove(+1);
  if (I.down('navUp')) board.cursorVertical(-1);
  if (I.down('navDown')) board.cursorVertical(+1);
  if (I.down('act')) board.cursorAct();
  if (I.down('cancel')) board.cursorCancel();

  // global actions
  if (I.down('draw')) board.onDraw();
  if (I.down('auto')) board.onAuto();
  if (I.down('undo')) board.onUndo();
  if (I.down('redo')) board.onRedo();
  if (I.down('hint')) board.onHint();
  if (I.down('newgame')) { won = false; game.newGame(drawMode); board.showToast(`New reactor — draw ${drawMode}.`, 4); }
  if (I.down('toggle')) {
    drawMode = drawMode === 1 ? 3 : 1;
    won = false; game.newGame(drawMode);
    board.showToast(`Feed mode: draw ${drawMode}. New reactor dealt.`, 5);
  }

  // session timer (counts up until solved)
  if (!game.state.won) game.state.time += ticker.deltaMS / 1000;

  board.tick(ticker.deltaMS);
});

window.addEventListener('resize', () => board.resize());
