/**
 * Starter game for diffenderfer.games — "collect the coins".
 *
 * It's a complete, working example of the pieces a hosted game uses:
 *   - PixiJS v8 for rendering
 *   - hub.input for unified keyboard / mouse / touch / gamepad controls
 *   - hub saves + leaderboards for cloud progress (offline-safe)
 *
 * Replace the gameplay with your own; keep the hub wiring patterns. See
 * CLAUDE.md for the build/integration rules and docs/hub.md for the full hub API.
 */
import { Application, Graphics, Text } from 'pixi.js';
import { hub } from './hub/hub';

const app = new Application();
await app.init({ resizeTo: window, background: '#0d0f14', antialias: true });
document.body.appendChild(app.canvas);

// ---------------------------------------------------------------------------
// Input — declare named inputs once; they work on every device. The hub draws
// the on-screen joystick/button for touch and maps gamepads automatically.
// ---------------------------------------------------------------------------
hub.input.define({
  groups: {
    play: {
      inputs: {
        left:   { keys: ['a', 'arrowleft'],  gamepad: { axis: [0, '-'] }, touch: { stick: 'move', axis: 'x-' } },
        right:  { keys: ['d', 'arrowright'], gamepad: { axis: [0, '+'] }, touch: { stick: 'move', axis: 'x+' } },
        up:     { keys: ['w', 'arrowup'],    gamepad: { axis: [1, '-'] }, touch: { stick: 'move', axis: 'y-' } },
        down:   { keys: ['s', 'arrowdown'],  gamepad: { axis: [1, '+'] }, touch: { stick: 'move', axis: 'y+' } },
        action: { keys: [' '], gamepad: { button: 0 }, mouse: { button: 0 }, touch: { button: 'a' } },
      },
      axes: { move: { x: ['left', 'right'], y: ['up', 'down'] } },
      virtual: [
        { id: 'move', type: 'joystick', place: 'bottom-left', size: 140 },
        { id: 'a', type: 'button', place: 'bottom-right', label: 'A', shape: 'circle', color: '#4ade80' },
      ],
    },
  },
});
hub.input.enable('play');

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const player = new Graphics().rect(-16, -16, 32, 32).fill('#ff5f3b');
player.position.set(app.screen.width / 2, app.screen.height / 2);
app.stage.addChild(player);

let coin = spawnCoin();
let score = 0;
let best = 0;

const hud = new Text({ text: 'Score: 0   Best: 0', style: { fill: '#e8e6df', fontFamily: 'monospace', fontSize: 18 } });
hud.position.set(12, 12);
app.stage.addChild(hud);

const hint = new Text({
  text: 'Move: WASD / arrows / stick / drag.  Collect the blue coins.',
  style: { fill: '#6f7787', fontFamily: 'monospace', fontSize: 13 },
});
hint.position.set(12, app.screen.height - 26);
app.stage.addChild(hint);

// Load the cloud/local best for this player (works offline; syncs when online).
hub.getSave<{ best: number }>('main').then((r) => {
  if (r.save && typeof r.save.data.best === 'number') { best = r.save.data.best; updateHud(); }
});

function spawnCoin(): Graphics {
  const c = new Graphics().circle(0, 0, 11).fill('#38d6ff');
  c.position.set(40 + Math.random() * (app.screen.width - 80), 40 + Math.random() * (app.screen.height - 80));
  app.stage.addChild(c);
  return c;
}
function updateHud(): void { hud.text = `Score: ${score}   Best: ${best}`; }

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
const SPEED = 340;
app.ticker.add((ticker) => {
  const dt = ticker.deltaMS / 1000;
  const move = hub.input.vector('move');           // { x, y, mag } — same on every device
  player.x = clamp(player.x + move.x * SPEED * dt, 16, app.screen.width - 16);
  player.y = clamp(player.y + move.y * SPEED * dt, 16, app.screen.height - 16);

  if (Math.hypot(player.x - coin.x, player.y - coin.y) < 28) {
    score += 1;
    coin.destroy(); coin = spawnCoin();
    if (score > best) {
      best = score;
      hub.putSave('main', { best });                       // cloud save (offline-safe)
      hub.submitScore('high', best, { title: 'High Score' }); // leaderboard
    }
    updateHud();
  }

  if (hub.input.down('action')) {                  // edge: true the frame it's pressed
    // example: a one-shot action — replace with yours
  }
});

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }

// keep the hint pinned on resize
window.addEventListener('resize', () => hint.position.set(12, app.screen.height - 26));
