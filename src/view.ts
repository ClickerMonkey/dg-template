/**
 * Pixi v8 view for the reactor. Renders engine state as energy cells in
 * conduits/cores/feed, and owns all interaction:
 *   - pointer drag-and-drop + tap-to-route (mouse & touch)
 *   - a focus cursor driven by keyboard / gamepad
 *   - lightweight motion (cells slide to their targets) + arcade FX
 *
 * It never decides legality — it asks the engine — so the solver state stays
 * pure Klondike.
 */
import { Application, Container, Graphics, Text, Rectangle, type TextStyleOptions } from 'pixi.js';
import { Game, ELEMENTS, polarityOf, type Card, type Source, type Dest } from './engine';
import { COLORS, ELEMENT_ACCENT, ELEMENT_GLYPH_NAME, polarityColor, drawGlyph } from './theme';

type SlotRef =
  | { kind: 'stock' }
  | { kind: 'waste' }
  | { kind: 'core'; i: number }
  | { kind: 'conduit'; i: number };

interface Geom {
  cardW: number; cardH: number; gap: number;
  conduitTop: number; fanUp: number; fanDown: number; radius: number;
  hub: { cx: number; cy: number; r: number };
  slots: { stock: P; waste: P; cores: P[]; conduits: P[] };
}
interface P { x: number; y: number; }

interface Located { kind: SlotRef['kind']; i: number; index: number; }

interface Drag {
  src: Source;
  ids: number[];
  offX: number; offY: number;
  px: number; py: number;
  moved: boolean;
  startX: number; startY: number;
}

interface Fx { node: Container; life: number; max: number; vy?: number; }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// --- a single energy cell ----------------------------------------------------

class CardView extends Container {
  card: Card;
  vx = 0; vy = 0;            // current (animated) position
  tx = 0; ty = 0;            // target
  wig = 0;                   // wiggle time remaining (s) — "no legal move" feedback
  private body = new Graphics();
  private deco = new Graphics();
  private num: Text;
  private sig = '';

  constructor(card: Card) {
    super();
    this.card = card;
    this.num = new Text({ text: '', style: { fill: COLORS.text, fontFamily: 'monospace', fontSize: 28, fontWeight: '800' } });
    this.num.anchor.set(0.5);
    this.addChild(this.body, this.deco, this.num);
  }

  render(card: Card, w: number, h: number, r: number): void {
    this.card = card;
    const sig = `${card.up ? 'U' : 'D'}:${card.el}:${card.rank}:${w}:${h}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const body = this.body.clear();
    const deco = this.deco.clear();

    if (!card.up) {
      // encrypted / uncharged cell — kept clearly visible so a fanned stack reads
      body.roundRect(0, 0, w, h, r).fill({ color: 0x102236 }).stroke({ width: 2, color: 0x305f8f, alpha: 0.95 });
      // header strip so each fanned card-top is distinct, with a "locked" gauge
      body.roundRect(0, 0, w, h * 0.30, r).fill({ color: 0x16314e, alpha: 0.8 });
      body.rect(0, h * 0.295, w, 1.5).fill({ color: 0x305f8f, alpha: 0.7 });
      const lk = 13, lx0 = w * 0.08, lx1 = w * 0.92, lw = (lx1 - lx0) / lk;
      for (let i = 0; i < lk; i += 1) deco.roundRect(lx0 + i * lw + lw * 0.12, h * 0.045, lw * 0.76, h * 0.04, 1).fill({ color: 0x274869, alpha: 0.8 });
      // diagonal scan lines
      const step = Math.max(8, w * 0.18);
      for (let d = -h; d < w; d += step) {
        deco.moveTo(clampN(d, 6, w - 6), h - 6).lineTo(clampN(d + h, 6, w - 6), 6);
      }
      deco.stroke({ width: 1, color: 0x3a6ea0, alpha: 0.4 });
      // lock glyph
      deco.circle(w / 2, h * 0.62, Math.min(w, h) * 0.15).stroke({ width: 2, color: 0x4aa0e0, alpha: 0.85 });
      deco.circle(w / 2, h * 0.62, Math.min(w, h) * 0.055).fill({ color: 0x4aa0e0, alpha: 0.85 });
      this.num.visible = false;
      return;
    }

    const pol = polarityColor(card.el);
    const accent = ELEMENT_ACCENT[card.el];
    // glow + body
    body.roundRect(-3, -2, w + 6, h + 6, r + 3).fill({ color: pol.hi, alpha: 0.10 });
    body.roundRect(0, 0, w, h, r).fill({ color: COLORS.cellBack });
    body.roundRect(0, 0, w, h, r).fill({ color: pol.lo, alpha: 0.35 });
    body.roundRect(0, 0, w, h, r).stroke({ width: 2.5, color: pol.hi, alpha: 0.95 });

    // Everything that identifies a cell lives in the TOP strip so it stays
    // readable when cells overlap down a conduit.
    // header bar tinted by polarity (reads hot/cold at a glance)
    body.roundRect(0, 0, w, h * 0.30, r).fill({ color: pol.hi, alpha: 0.16 });
    body.rect(0, h * 0.295, w, 1.5).fill({ color: pol.hi, alpha: 0.5 });

    // horizontal charge gauge across the very top (rank / 13 segments)
    const segs = 13, gx0 = w * 0.08, gx1 = w * 0.92, gy = h * 0.045, gh = h * 0.04;
    const sw = (gx1 - gx0) / segs;
    for (let i = 0; i < segs; i += 1) {
      const filled = i < card.rank;
      deco.roundRect(gx0 + i * sw + sw * 0.12, gy, sw * 0.76, gh, 1)
        .fill({ color: filled ? pol.hi : 0x14233b, alpha: filled ? 0.95 : 0.6 });
    }

    // big faint element glyph watermark (only seen on a fully-exposed cell)
    drawGlyph(deco, card.el, w * 0.5, h * 0.64, Math.min(w, h) * 0.30, accent, 0.12);
    // crisp element glyph in the top-right of the header
    drawGlyph(deco, card.el, w * 0.76, h * 0.185, Math.min(w, h) * 0.105, accent);

    // charge number — top-left of the header, always visible
    this.num.visible = true;
    this.num.text = String(card.rank);
    this.num.style.fontSize = Math.round(h * 0.20);
    this.num.style.fill = COLORS.text;
    this.num.position.set(w * 0.28, h * 0.185);
  }
}

// --- the board ---------------------------------------------------------------

export class BoardView {
  private app: Application;
  game: Game;
  private bg = new Graphics();
  private markers = new Graphics();
  private cardsLayer = new Container();
  private hi = new Graphics();
  private fxLayer = new Container();
  private hud = new Container();

  private cardViews = new Map<number, CardView>();
  private locate = new Map<number, Located>();
  private geom!: Geom;

  private drag: Drag | null = null;
  private selection: Source | null = null;
  private cursor = 0;          // index into slotList
  private grabDepth = 1;       // for conduit selection (cards from top)
  private showCursor = false;  // true when last input was gamepad/keys
  private lastTap = { id: -1, t: 0 };
  private fx: Fx[] = [];

  private scoreT: Text; private comboT: Text; private timeT: Text; private statusT: Text; private toastT: Text;
  private toastLife = 0; private toastMax = 1;
  private hintFlash: { slot: SlotRef; card: Card; t: number } | null = null;

  constructor(app: Application, game: Game) {
    this.app = app;
    this.game = game;
    this.cardsLayer.sortableChildren = true;
    app.stage.addChild(this.bg, this.markers, this.cardsLayer, this.hi, this.fxLayer, this.hud);

    const mk = (style: Partial<TextStyleOptions>): Text => {
      const t = new Text({ text: '', style: { fontFamily: 'monospace', fill: COLORS.text, fontSize: 18, ...style } });
      this.hud.addChild(t); return t;
    };
    this.scoreT = mk({ fontSize: 20, fontWeight: '800' });
    this.timeT = mk({ fill: COLORS.textDim });
    this.comboT = mk({ fontSize: 20, fontWeight: '800', fill: COLORS.hint });
    this.statusT = mk({ fontSize: 22, fontWeight: '800', fill: COLORS.win });
    this.statusT.anchor.set(0.5, 0);
    this.toastT = mk({ fontSize: 15, fill: COLORS.textDim, align: 'center' });
    this.toastT.anchor.set(0.5, 1);
    this.toastT.visible = false;

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', this.onDown);
    app.stage.on('pointermove', this.onMove);
    app.stage.on('pointerup', this.onUp);
    app.stage.on('pointerupoutside', this.onUp);

    this.layout();
    this.reconcile(false);
  }

  // --- geometry --------------------------------------------------------------

  layout(): void {
    const W = this.app.screen.width, H = this.app.screen.height;
    // Portrait/narrow screens (phones) get a stacked layout; wide screens get
    // the flanking-banks layout. Both keep the central reactor core-ring.
    if (W / H < 1.1) this.layoutPortrait(W, H);
    else this.layoutLandscape(W, H);
    this.drawBackground();
    this.layoutHud();
  }

  private layoutLandscape(W: number, H: number): void {
    const topHUD = Math.max(46, H * 0.06);
    // Two banks of vertical conduit rails (4 left + 3 right) flank the ring;
    // the feed battery sits above it.
    const L = 4, Rn = 3, gR = 0.22, bankGap = 0.6, pad = 0.35, rho = 1.18;
    const units = pad * 2 + (L + (L - 1) * gR) + bankGap + (2 * rho + 1) + bankGap + (Rn + (Rn - 1) * gR);
    let cardW = Math.min(W / units, 122);
    cardW = Math.min(cardW, (H - topHUD - 70) / 5.2);
    cardW = Math.max(cardW, 36);
    const cardH = cardW * 1.42;
    const gap = cardW * gR;
    const radius = Math.max(6, cardW * 0.10);
    const R = cardW * rho;

    const totalW = cardW * units;
    let x = (W - totalW) / 2 + cardW * pad;
    const leftXs: number[] = [];
    for (let i = 0; i < L; i += 1) { leftXs.push(x); x += cardW + gap; }
    const centerStart = x - gap + cardW * bankGap;
    const centerW = (2 * rho + 1) * cardW;
    const cx = centerStart + centerW / 2;
    x = centerStart + centerW + cardW * bankGap;
    const rightXs: number[] = [];
    for (let i = 0; i < Rn; i += 1) { rightXs.push(x); x += cardW + gap; }

    const conduitTop = topHUD + 6;
    const feedY = topHUD + 8;
    const cy = feedY + cardH * 1.5 + R + 26;
    const { fanUp, fanDown } = this.fans(cardH, conduitTop, H, Math.max(16, H * 0.03));

    this.commitGeom(cardW, cardH, gap, radius, conduitTop, fanUp, fanDown, cx, cy, R, feedY,
      [...leftXs, ...rightXs], { stockX: cx - cardW - gap / 2, wasteX: cx + gap / 2, feedY });
  }

  private layoutPortrait(W: number, H: number): void {
    const topHUD = Math.max(40, H * 0.035);
    const sidePad = Math.max(8, W * 0.02);
    const cols = 7, gR = 0.16;
    let cardW = (W - sidePad * 2) / (cols + (cols - 1) * gR);
    cardW = Math.min(cardW, 116);
    const cardH = cardW * 1.42;
    const gap = cardW * gR;
    const radius = Math.max(5, cardW * 0.10);
    const R = cardW * 1.12;
    const gridW = cols * cardW + (cols - 1) * gap;
    const left = (W - gridW) / 2;

    const cx = W / 2;
    const feedY = topHUD + 6;
    const cy = feedY + cardH + 16 + R;                 // ring sits below the feed row
    const conduitTop = cy + R + cardH * 0.5 + 16;       // conduits across the bottom
    // leave room at the very bottom for the on-screen control buttons on touch
    const bottomReserve = Math.max(64, H * 0.10);
    const { fanUp, fanDown } = this.fans(cardH, conduitTop, H, bottomReserve);

    const conduitXs: number[] = [];
    for (let c = 0; c < cols; c += 1) conduitXs.push(left + c * (cardW + gap));

    this.commitGeom(cardW, cardH, gap, radius, conduitTop, fanUp, fanDown, cx, cy, R, feedY,
      conduitXs, { stockX: cx - cardW - gap / 2, wasteX: cx + gap / 2, feedY });
  }

  private fans(cardH: number, conduitTop: number, H: number, bottomReserve: number): { fanUp: number; fanDown: number } {
    let fanUp = cardH * 0.34, fanDown = cardH * 0.14;
    const longest = this.longestColumn();
    const avail = H - conduitTop - cardH - bottomReserve;
    const needed = (longest.up - 1) * fanUp + longest.down * fanDown;
    if (needed > avail && needed > 0) { const k = avail / needed; fanUp *= k; fanDown *= k; }
    return { fanUp, fanDown };
  }

  private commitGeom(
    cardW: number, cardH: number, gap: number, radius: number, conduitTop: number,
    fanUp: number, fanDown: number, cx: number, cy: number, R: number, feedY: number,
    conduitXs: number[], feed: { stockX: number; wasteX: number; feedY: number },
  ): void {
    const coreC = [
      { x: cx, y: cy - R },     // 0 top
      { x: cx + R, y: cy },     // 1 right
      { x: cx, y: cy + R },     // 2 bottom
      { x: cx - R, y: cy },     // 3 left
    ];
    this.geom = {
      cardW, cardH, gap, conduitTop, fanUp, fanDown, radius,
      hub: { cx, cy, r: R },
      slots: {
        stock: { x: feed.stockX, y: feed.feedY },
        waste: { x: feed.wasteX, y: feed.feedY },
        cores: coreC.map((c) => ({ x: c.x - cardW / 2, y: c.y - cardH / 2 })),
        conduits: conduitXs.map((xx) => ({ x: xx, y: conduitTop })),
      },
    };
  }

  private longestColumn(): { up: number; down: number } {
    let up = 1, down = 0;
    for (const col of this.game.state.conduits) {
      let u = 0, d = 0;
      for (const c of col) (c.up ? u++ : d++);
      up = Math.max(up, u); down = Math.max(down, d);
    }
    return { up: Math.max(up, 8), down };
  }

  private drawBackground(): void {
    const W = this.app.screen.width, H = this.app.screen.height;
    const g = this.bg.clear();
    g.rect(0, 0, W, H).fill({ color: COLORS.bg });
    const { cardW, conduitTop, slots, radius, hub } = this.geom;
    const { cx, cy, r: R } = hub;

    // coolant pipes: each conduit feeds the central core-ring
    for (const s of slots.conduits) {
      const px = s.x + cardW / 2, py = conduitTop + cardW * 0.2;
      const ang = Math.atan2(cy - py, cx - px);
      const ex = cx - Math.cos(ang) * (R + cardW * 0.7), ey = cy - Math.sin(ang) * (R + cardW * 0.7);
      g.moveTo(px, py).lineTo(ex, ey).stroke({ width: Math.max(2, cardW * 0.06), color: COLORS.panelEdge, alpha: 0.45 });
      g.circle(ex, ey, cardW * 0.07).fill({ color: COLORS.panelEdge, alpha: 0.6 });
    }
    // faint vertical rail glow behind each conduit
    for (const s of slots.conduits) {
      g.roundRect(s.x - 4, conduitTop - 10, cardW + 8, H - conduitTop - 6, radius + 4)
        .fill({ color: COLORS.bgGlow, alpha: 0.5 });
    }
    // central reactor core-ring
    g.circle(cx, cy, R + cardW * 0.85).fill({ color: COLORS.bgGlow, alpha: 0.6 });
    g.circle(cx, cy, R + cardW * 0.65).stroke({ width: Math.max(2, cardW * 0.05), color: COLORS.panelEdge, alpha: 0.8 });
    g.circle(cx, cy, R).stroke({ width: Math.max(1, cardW * 0.03), color: COLORS.panelEdge, alpha: 0.5 });
    // glowing hub at the centre
    g.circle(cx, cy, cardW * 0.42).fill({ color: COLORS.panel });
    g.circle(cx, cy, cardW * 0.42).stroke({ width: 2, color: COLORS.cold, alpha: 0.6 });
    g.circle(cx, cy, cardW * 0.20).fill({ color: COLORS.cold, alpha: 0.55 });
  }

  private layoutHud(): void {
    const W = this.app.screen.width;
    this.scoreT.position.set(14, 14);
    this.timeT.position.set(14, 40);
    this.comboT.position.set(W - 14, 14);
    this.comboT.anchor.set(1, 0);
    this.statusT.position.set(W / 2, 12);
    this.toastT.position.set(W / 2, this.app.screen.height - 10);
  }

  showToast(msg: string, secs = 7): void {
    this.toastT.text = msg;
    this.toastT.visible = true;
    this.toastLife = secs; this.toastMax = secs;
  }

  // --- markers (empty pile hints) -------------------------------------------

  private drawMarkers(): void {
    const g = this.markers.clear();
    const { cardW, cardH, radius, slots } = this.geom;
    const outline = (p: P, color: number) =>
      g.roundRect(p.x, p.y, cardW, cardH, radius).stroke({ width: 2, color, alpha: 0.45 });

    // feed battery (stock)
    if (this.game.state.stock.length === 0) {
      outline(slots.stock, COLORS.panelEdge);
      // recycle symbol
      const cx = slots.stock.x + cardW / 2, cy = slots.stock.y + cardH / 2, r = Math.min(cardW, cardH) * 0.2;
      g.arc(cx, cy, r, -2.2, 1.0).stroke({ width: 3, color: COLORS.textDim, alpha: 0.7 });
      g.arc(cx, cy, r, 1.0, 4.2).stroke({ width: 3, color: COLORS.textDim, alpha: 0.7 });
    }
    if (this.game.state.waste.length === 0) outline(slots.waste, COLORS.panelEdge);

    // cores — faint glyph of the element each accepts
    slots.cores.forEach((p, i) => {
      if (this.game.state.cores[i].length === 0) {
        const pol = polarityColor(i);
        g.roundRect(p.x, p.y, cardW, cardH, radius)
          .fill({ color: pol.lo, alpha: 0.18 }).stroke({ width: 2, color: pol.hi, alpha: 0.45 });
        drawGlyph(g, i, p.x + cardW / 2, p.y + cardH / 2, Math.min(cardW, cardH) * 0.22, ELEMENT_ACCENT[i]);
      }
    });

    // empty conduits
    slots.conduits.forEach((p, i) => {
      if (this.game.state.conduits[i].length === 0) outline(p, COLORS.panelEdge);
    });
  }

  // --- reconcile state → views ----------------------------------------------

  reconcile(animate: boolean): void {
    const { cardW, cardH, radius } = this.geom;
    this.drawMarkers();
    this.locate.clear();

    const seen = new Set<number>();
    let z = 0;
    const place = (card: Card, x: number, y: number, loc: Located) => {
      let v = this.cardViews.get(card.id);
      if (!v) {
        v = new CardView(card);
        v.vx = x; v.vy = y; v.position.set(x, y);
        this.cardViews.set(card.id, v);
        this.cardsLayer.addChild(v);
        animate = animate && false; // brand-new view: don't animate from 0
      }
      v.render(card, cardW, cardH, radius);
      v.tx = x; v.ty = y; v.zIndex = z++;
      if (!animate) { v.vx = x; v.vy = y; v.position.set(x, y); }
      this.locate.set(card.id, loc);
      seen.add(card.id);
    };

    const s = this.game.state;
    // stock (stacked, slight depth)
    s.stock.forEach((c, idx) => {
      const p = this.geom.slots.stock;
      place(c, p.x + Math.min(idx, 6) * 0.6, p.y + Math.min(idx, 6) * 0.6, { kind: 'stock', i: 0, index: idx });
    });
    // waste — last up to 3 fanned right
    const wp = this.geom.slots.waste;
    const fanStart = Math.max(0, s.waste.length - 3);
    s.waste.forEach((c, idx) => {
      const f = Math.max(0, idx - fanStart);
      place(c, wp.x + f * cardW * 0.28, wp.y, { kind: 'waste', i: 0, index: idx });
    });
    // cores (stacked)
    s.cores.forEach((col, i) => {
      const p = this.geom.slots.cores[i];
      col.forEach((c, idx) => place(c, p.x, p.y + Math.min(idx, 2) * 0.5, { kind: 'core', i, index: idx }));
    });
    // conduits (fanned)
    s.conduits.forEach((col, i) => {
      const p = this.geom.slots.conduits[i];
      let y = p.y;
      col.forEach((c, idx) => {
        place(c, p.x, y, { kind: 'conduit', i, index: idx });
        y += c.up ? this.geom.fanUp : this.geom.fanDown;
      });
    });

    // drop any views whose card vanished (shouldn't happen — 52 constant)
    for (const [id, v] of this.cardViews) {
      if (!seen.has(id)) { v.destroy(); this.cardViews.delete(id); }
    }

    this.updateHud();
  }

  // --- HUD -------------------------------------------------------------------

  private updateHud(): void {
    const s = this.game.state;
    this.scoreT.text = `OUTPUT ${s.score}`;
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
    this.timeT.text = `T ${mm}:${ss.toString().padStart(2, '0')}   ROUTES ${s.moves}`;
    this.comboT.text = s.combo >= 2 ? `CHAIN x${s.combo}` : '';
    if (s.won) { this.statusT.text = 'REACTOR ONLINE — all coolant routed!'; this.statusT.visible = true; }
    else this.statusT.visible = false;
  }

  // --- hit testing -----------------------------------------------------------

  private cardAt(x: number, y: number): { id: number; loc: Located } | null {
    const { cardW, cardH } = this.geom;
    let best: { id: number; loc: Located; z: number } | null = null;
    for (const [id, v] of this.cardViews) {
      if (x >= v.vx && x <= v.vx + cardW && y >= v.vy && y <= v.vy + cardH) {
        if (!best || v.zIndex > best.z) best = { id, loc: this.locate.get(id)!, z: v.zIndex };
      }
    }
    return best ? { id: best.id, loc: best.loc } : null;
  }

  /** Pile under a point, for drop targeting (uses generous column rects). */
  private slotAt(x: number, y: number): SlotRef | null {
    const { cardW, cardH, slots } = this.geom;
    const inBox = (p: P, w = cardW, h = cardH) => x >= p.x && x <= p.x + w && y >= p.y && y <= p.y + h;
    if (inBox(slots.stock)) return { kind: 'stock' };
    if (inBox(slots.waste, cardW * 1.6)) return { kind: 'waste' };
    for (let i = 0; i < 4; i += 1) if (inBox(slots.cores[i])) return { kind: 'core', i };
    // conduits: tall hit area to the bottom of the screen
    for (let i = 0; i < 7; i += 1) {
      const p = slots.conduits[i];
      if (x >= p.x && x <= p.x + cardW && y >= p.y && y <= this.app.screen.height) return { kind: 'conduit', i };
    }
    return null;
  }

  // --- pointer interaction ---------------------------------------------------

  private srcFromLoc(loc: Located): Source | null {
    if (loc.kind === 'waste') return { kind: 'waste' };
    if (loc.kind === 'core') return { kind: 'core', i: loc.i };
    if (loc.kind === 'conduit') {
      if (this.game.isMovableRun(loc.i, loc.index)) return { kind: 'conduit', i: loc.i, start: loc.index };
      return null;
    }
    return null;
  }

  private onDown = (e: any): void => {
    this.showCursor = false;
    const x = e.global.x, y = e.global.y;
    const hit = this.cardAt(x, y);
    if (!hit) { this.selection = null; this.updateHi(); return; }

    if (hit.loc.kind === 'stock') { /* handled as a tap on up */ return; }
    const src = this.srcFromLoc(hit.loc);
    if (!src) return;

    const v = this.cardViews.get(hit.id)!;
    const ids = this.game.cardsOf(src).map((c) => c.id);
    this.drag = {
      src, ids, offX: x - v.vx, offY: y - v.vy, px: x, py: y,
      moved: false, startX: x, startY: y,
    };
  };

  private onMove = (e: any): void => {
    if (!this.drag) return;
    const x = e.global.x, y = e.global.y;
    if (!this.drag.moved && Math.hypot(x - this.drag.startX, y - this.drag.startY) > 8) this.drag.moved = true;
    this.drag.px = x; this.drag.py = y;
  };

  private onUp = (e: any): void => {
    const x = e.global.x, y = e.global.y;
    const drag = this.drag;
    this.drag = null;

    if (drag && drag.moved) {
      // a real drag → drop
      const slot = this.slotAt(x, y);
      this.tryDropDrag(drag, slot);
      this.selection = null; this.updateHi();
      return;
    }

    // a tap/click
    const hit = this.cardAt(x, y);
    const slot = this.slotAt(x, y);

    if (slot && slot.kind === 'stock') { this.onDraw(); this.selection = null; this.updateHi(); return; }

    // double-tap → auto-route (core first, then any legal conduit, else wiggle)
    if (hit) {
      const now = performance.now();
      if (this.lastTap.id === hit.id && now - this.lastTap.t < 320) {
        this.lastTap = { id: -1, t: 0 };
        const src = this.srcFromLoc(hit.loc) || this.srcFromTopOf(hit.loc);
        if (src) { if (!this.autoMove(src)) this.wiggleSrc(src); this.selection = null; this.updateHi(); return; }
      }
      this.lastTap = { id: hit.id, t: now };
    }

    if (this.selection) {
      // try to route the current selection to the tapped pile
      if (slot && this.commitTo(this.selection, slot)) { this.selection = null; this.updateHi(); return; }
      // tapping the same selected card → auto-route it
      if (hit) {
        const again = this.srcFromLoc(hit.loc) || this.srcFromTopOf(hit.loc);
        if (again && this.sameSource(again, this.selection)) {
          if (!this.autoMove(again)) this.wiggleSrc(again);
          this.selection = null; this.updateHi(); return;
        }
      }
      this.selection = null;
    }
    // otherwise select what was tapped (if grabbable)
    if (hit) {
      const src = this.srcFromLoc(hit.loc);
      if (src) this.selection = src;
    }
    this.updateHi();
  };

  private srcFromTopOf(loc: Located): Source | null {
    // for routing a single top card to a core
    const s = this.game.state;
    if (loc.kind === 'waste') return s.waste.length ? { kind: 'waste' } : null;
    if (loc.kind === 'core') return s.cores[loc.i].length ? { kind: 'core', i: loc.i } : null;
    if (loc.kind === 'conduit') {
      const col = s.conduits[loc.i];
      if (col.length && col[col.length - 1].up) return { kind: 'conduit', i: loc.i, start: col.length - 1 };
    }
    return null;
  }

  private sameSource(a: Source, b: Source): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'core' && b.kind === 'core') return a.i === b.i;
    if (a.kind === 'conduit' && b.kind === 'conduit') return a.i === b.i && a.start === b.start;
    return a.kind === 'waste';
  }

  private tryDropDrag(drag: Drag, slot: SlotRef | null): void {
    if (!slot) return;
    if (!this.commitTo(drag.src, slot)) {
      // dropped somewhere illegal → wiggle to signal "no"
      const onPile = slot.kind === 'core' || slot.kind === 'conduit';
      if (onPile) this.wiggleSrc(drag.src);
    }
  }

  /**
   * Auto-route a source: first to its reactor core, otherwise to the best legal
   * conduit (prefer building on an existing stack over opening an empty rail).
   * Returns false if there's nowhere legal to go.
   */
  private autoMove(src: Source): boolean {
    const cards = this.game.cardsOf(src);
    if (!cards.length) return false;
    // 1) a single cell → its core, if it fits
    if (cards.length === 1 && this.game.canMove(src, { kind: 'core', i: cards[0].el })) {
      return this.commitTo(src, { kind: 'core', i: cards[0].el });
    }
    // 2) a conduit that already has cells (builds a sequence)
    let emptyTarget = -1;
    for (let i = 0; i < 7; i += 1) {
      if (!this.game.canMove(src, { kind: 'conduit', i })) continue;
      if (this.game.state.conduits[i].length > 0) return this.commitTo(src, { kind: 'conduit', i });
      if (emptyTarget < 0) emptyTarget = i;
    }
    // 3) an empty conduit — but not if that's a no-op (moving a whole rail to another empty rail)
    if (emptyTarget >= 0 && !(src.kind === 'conduit' && src.start === 0)) {
      return this.commitTo(src, { kind: 'conduit', i: emptyTarget });
    }
    return false;
  }

  private wiggleSrc(src: Source): void {
    for (const c of this.game.cardsOf(src)) {
      const v = this.cardViews.get(c.id);
      if (v) v.wig = 0.4;
    }
  }

  /** Attempt to move a source onto a slot; returns true on success + FX. */
  private commitTo(src: Source, slot: SlotRef): boolean {
    let dest: Dest;
    if (slot.kind === 'core') dest = { kind: 'core', i: slot.i };
    else if (slot.kind === 'conduit') dest = { kind: 'conduit', i: slot.i };
    else return false; // stock / waste are never drop targets
    const out = this.game.move(src, dest);
    if (out.ok) {
      if (out.toCore && dest.kind === 'core') this.coreFx({ kind: 'core', i: dest.i }, out);
      this.bump();
      return true;
    }
    return false;
  }

  // --- cursor (keyboard / gamepad) ------------------------------------------

  private slotList(): SlotRef[] {
    return [
      { kind: 'stock' }, { kind: 'waste' },
      { kind: 'core', i: 0 }, { kind: 'core', i: 1 }, { kind: 'core', i: 2 }, { kind: 'core', i: 3 },
      { kind: 'conduit', i: 0 }, { kind: 'conduit', i: 1 }, { kind: 'conduit', i: 2 },
      { kind: 'conduit', i: 3 }, { kind: 'conduit', i: 4 }, { kind: 'conduit', i: 5 }, { kind: 'conduit', i: 6 },
    ];
  }

  cursorMove(dir: number): void {
    this.showCursor = true;
    const list = this.slotList();
    this.cursor = (this.cursor + dir + list.length) % list.length;
    this.grabDepth = 1;
    this.updateHi();
  }

  cursorVertical(dir: number): void {
    this.showCursor = true;
    const slot = this.slotList()[this.cursor];
    if (slot.kind !== 'conduit') return;
    const col = this.game.state.conduits[slot.i];
    // deepest grabbable start
    let minStart = col.length;
    for (let s = col.length - 1; s >= 0; s -= 1) { if (this.game.isMovableRun(slot.i, s)) minStart = s; else break; }
    const maxDepth = Math.max(1, col.length - minStart);
    this.grabDepth = clampN(this.grabDepth + (dir < 0 ? 1 : -1), 1, maxDepth);
    this.updateHi();
  }

  cursorAct(): void {
    this.showCursor = true;
    const slot = this.slotList()[this.cursor];
    if (slot.kind === 'stock') { this.onDraw(); return; }

    if (this.selection) {
      if (this.commitTo(this.selection, slot)) { this.selection = null; this.updateHi(); return; }
      // act on own source again → auto-route it
      const top = this.topSourceOfSlot(slot);
      if (top && this.sameSource(top, this.selection)) {
        if (!this.autoMove(top)) this.wiggleSrc(top);
        this.selection = null; this.updateHi(); return;
      }
      this.selection = null; this.updateHi();
      return;
    }
    // no selection → pick from this slot
    const src = this.selectableSource(slot);
    if (src) this.selection = src;
    this.updateHi();
  }

  cursorCancel(): void { this.selection = null; this.updateHi(); }

  private topSourceOfSlot(slot: SlotRef): Source | null {
    const s = this.game.state;
    if (slot.kind === 'waste') return s.waste.length ? { kind: 'waste' } : null;
    if (slot.kind === 'core') return s.cores[slot.i].length ? { kind: 'core', i: slot.i } : null;
    if (slot.kind === 'conduit') {
      const col = s.conduits[slot.i];
      if (col.length && col[col.length - 1].up) return { kind: 'conduit', i: slot.i, start: col.length - 1 };
    }
    return null;
  }

  private selectableSource(slot: SlotRef): Source | null {
    const s = this.game.state;
    if (slot.kind === 'waste') return s.waste.length ? { kind: 'waste' } : null;
    if (slot.kind === 'core') return s.cores[slot.i].length ? { kind: 'core', i: slot.i } : null;
    if (slot.kind === 'conduit') {
      const col = s.conduits[slot.i];
      const start = col.length - this.grabDepth;
      if (start >= 0 && this.game.isMovableRun(slot.i, start)) return { kind: 'conduit', i: slot.i, start };
    }
    return null;
  }

  // --- actions exposed to main ----------------------------------------------

  onDraw(): void { if (this.game.draw()) this.bump(); }
  onUndo(): void { this.game.undo(); }
  onRedo(): void { this.game.redo(); }
  onAuto(): void {
    const before = this.game.state.cores.reduce((a, c) => a + c.length, 0);
    const n = this.game.autoAll();
    if (n) { this.bump(); }
    const after = this.game.state.cores.reduce((a, c) => a + c.length, 0);
    if (after > before) this.flashAllCores();
  }
  onHint(): void {
    const h = this.findHint();
    if (h) this.hintFlash = { ...h, t: 1.4 };
  }

  /** Find one legal move to surface as a hint (prefers core deliveries). */
  private findHint(): { slot: SlotRef; card: Card } | null {
    const g = this.game, s = g.state;
    // to cores first
    const sources: { src: Source; card: Card }[] = [];
    if (s.waste.length) sources.push({ src: { kind: 'waste' }, card: s.waste[s.waste.length - 1] });
    s.conduits.forEach((col, i) => { if (col.length && col[col.length - 1].up) sources.push({ src: { kind: 'conduit', i, start: col.length - 1 }, card: col[col.length - 1] }); });
    for (const { src, card } of sources) if (g.canDropOnCore(card.el, card)) return { slot: { kind: 'core', i: card.el }, card };
    // run moves between conduits / waste to conduit
    const runs: { src: Source; card: Card }[] = [];
    if (s.waste.length) runs.push({ src: { kind: 'waste' }, card: s.waste[s.waste.length - 1] });
    s.conduits.forEach((col, i) => {
      for (let st = 0; st < col.length; st += 1) if (col[st].up && g.isMovableRun(i, st)) { runs.push({ src: { kind: 'conduit', i, start: st }, card: col[st] }); break; }
    });
    for (const { src, card } of runs) {
      for (let i = 0; i < 7; i += 1) {
        if (src.kind === 'conduit' && src.i === i) continue;
        if (g.canDropOnConduit(i, card)) return { slot: { kind: 'conduit', i }, card };
      }
    }
    return null;
  }

  // --- FX & highlight --------------------------------------------------------

  private bump(): void { /* hook for sfx; reconcile happens via onChange */ }

  private coreFx(slot: { kind: 'core'; i: number }, out: { combo: number; gained: number }): void {
    const p = this.geom.slots.cores[slot.i];
    const cx = p.x + this.geom.cardW / 2, cy = p.y + this.geom.cardH / 2;
    const ring = new Graphics().circle(0, 0, this.geom.cardW * 0.5).stroke({ width: 3, color: ELEMENT_ACCENT[slot.i] });
    ring.position.set(cx, cy);
    this.fxLayer.addChild(ring);
    this.fx.push({ node: ring, life: 0.5, max: 0.5 });
    if (out.combo >= 2) {
      const t = new Text({ text: `CHAIN x${out.combo}  +${out.gained}`, style: { fontFamily: 'monospace', fontWeight: '800', fontSize: 22, fill: COLORS.hint } });
      t.anchor.set(0.5); t.position.set(cx, cy - this.geom.cardH * 0.6);
      this.fxLayer.addChild(t);
      this.fx.push({ node: t, life: 0.9, max: 0.9, vy: -40 });
    }
  }

  private flashAllCores(): void {
    this.geom.slots.cores.forEach((p, i) => {
      if (!this.game.state.cores[i].length) return;
      const cx = p.x + this.geom.cardW / 2, cy = p.y + this.geom.cardH / 2;
      const ring = new Graphics().circle(0, 0, this.geom.cardW * 0.5).stroke({ width: 3, color: ELEMENT_ACCENT[i] });
      ring.position.set(cx, cy); this.fxLayer.addChild(ring);
      this.fx.push({ node: ring, life: 0.6, max: 0.6 });
    });
  }

  private updateHi(): void {
    const g = this.hi.clear();
    const { cardW, cardH, radius, slots } = this.geom;

    // selection highlight
    if (this.selection) {
      const ids = this.game.cardsOf(this.selection).map((c) => c.id);
      for (const id of ids) {
        const v = this.cardViews.get(id);
        if (v) g.roundRect(v.vx - 3, v.vy - 3, cardW + 6, cardH + 6, radius + 3).stroke({ width: 3, color: COLORS.select, alpha: 0.95 });
      }
    }

    // cursor ring
    if (this.showCursor) {
      const slot = this.slotList()[this.cursor];
      const p = this.slotPos(slot);
      let h = cardH;
      if (slot.kind === 'conduit') {
        const col = this.game.state.conduits[slot.i];
        if (col.length) {
          const lastV = this.cardViews.get(col[col.length - 1].id);
          if (lastV) h = lastV.vy + cardH - p.y;
        }
      }
      g.roundRect(p.x - 5, p.y - 5, cardW + 10, h + 10, radius + 5).stroke({ width: 3, color: COLORS.cold, alpha: 0.9 });
      // grab-depth marker on a conduit
      if (slot.kind === 'conduit' && !this.selection) {
        const col = this.game.state.conduits[slot.i];
        const start = col.length - this.grabDepth;
        if (start >= 0) {
          const v = this.cardViews.get(col[start].id);
          if (v) g.roundRect(v.vx - 3, v.vy - 3, cardW + 6, cardH + 6, radius + 3).stroke({ width: 3, color: COLORS.select, alpha: 0.8 });
        }
      }
    }

    // hint flash
    if (this.hintFlash) {
      const v = this.cardViews.get(this.hintFlash.card.id);
      if (v) g.roundRect(v.vx - 4, v.vy - 4, cardW + 8, cardH + 8, radius + 4).stroke({ width: 4, color: COLORS.hint, alpha: 0.9 });
      const p = this.slotPos(this.hintFlash.slot);
      g.roundRect(p.x - 4, p.y - 4, cardW + 8, cardH + 8, radius + 4).stroke({ width: 4, color: COLORS.hint, alpha: 0.7 });
    }
  }

  private slotPos(slot: SlotRef): P {
    const sl = this.geom.slots;
    if (slot.kind === 'stock') return sl.stock;
    if (slot.kind === 'waste') return sl.waste;
    if (slot.kind === 'core') return sl.cores[slot.i];
    return sl.conduits[slot.i];
  }

  // --- per-frame -------------------------------------------------------------

  tick(dtMs: number): void {
    const dt = dtMs / 1000;
    const k = 1 - Math.pow(0.001, dt); // smoothing factor

    for (const [id, v] of this.cardViews) {
      let tx = v.tx, ty = v.ty, snap = false;
      if (this.drag && this.drag.ids.includes(id)) {
        const idx = this.drag.ids.indexOf(id);
        tx = this.drag.px - this.drag.offX;
        ty = this.drag.py - this.drag.offY + idx * this.geom.fanUp;
        v.zIndex = 10000 + idx;
        snap = true;
      }
      v.vx = snap ? tx : lerp(v.vx, tx, k);
      v.vy = snap ? ty : lerp(v.vy, ty, k);
      let wx = 0;
      if (v.wig > 0) { v.wig = Math.max(0, v.wig - dt); wx = Math.sin((0.4 - v.wig) * 46) * this.geom.cardW * 0.12 * (v.wig / 0.4); }
      v.position.set(v.vx + wx, v.vy);
    }

    // FX life
    for (let i = this.fx.length - 1; i >= 0; i -= 1) {
      const f = this.fx[i];
      f.life -= dt;
      const p = f.life / f.max;
      f.node.alpha = Math.max(0, p);
      if (f.vy) f.node.y += f.vy * dt;
      if ('scale' in f.node) (f.node as any).scale.set(1 + (1 - p) * 0.6);
      if (f.life <= 0) { f.node.destroy(); this.fx.splice(i, 1); }
    }

    if (this.hintFlash) { this.hintFlash.t -= dt; if (this.hintFlash.t <= 0) this.hintFlash = null; }

    if (this.toastLife > 0) {
      this.toastLife -= dt;
      this.toastT.alpha = Math.min(1, this.toastLife / Math.min(1.5, this.toastMax));
      if (this.toastLife <= 0) this.toastT.visible = false;
    }

    // keep selection/cursor outlines tracking moving cards
    this.updateHi();
  }

  resize(): void {
    this.app.stage.hitArea = this.app.screen;
    this.layout();
    this.reconcile(false);
    this.updateHi();
  }
}

function clampN(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }
