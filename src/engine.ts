/**
 * Reactor coolant routing — game engine.
 *
 * Under the neon skin this is bit-for-bit Klondike solitaire:
 *   - energy cells          = cards (rank 1..13 = charge, element = suit)
 *   - polarity (hot/cold)   = card colour (alternates in a conduit)
 *   - 7 conduits            = tableau columns (build DOWN, alternating polarity)
 *   - 4 reactor cores       = foundations (build UP 1..13, one per element)
 *   - feed battery / buffer = stock / waste (draw 1 or 3)
 *   - win                   = every cell routed into a core
 *
 * The engine is pure data + rules; the view renders it and the scoring/combo
 * layer on top is arcade juice that never touches the solver state.
 */

export type Polarity = 'hot' | 'cold';

export interface ElementDef {
  id: number;
  name: string;
  /** Shared alternation property — two hot, two cold (red/black in Klondike). */
  polarity: Polarity;
}

/** Four element types = four suits. Two hot, two cold (the alternation pair). */
export const ELEMENTS: ElementDef[] = [
  { id: 0, name: 'Pyron', polarity: 'hot' },
  { id: 1, name: 'Solis', polarity: 'hot' },
  { id: 2, name: 'Cryon', polarity: 'cold' },
  { id: 3, name: 'Aether', polarity: 'cold' },
];

export interface Card {
  /** Stable id (el*13 + rank-1), so views persist across moves. */
  id: number;
  el: number;   // element index 0..3
  rank: number; // 1..13 (charge level)
  up: boolean;  // exposed/charged (face up) vs encrypted (face down)
}

export function polarityOf(c: Card): Polarity { return ELEMENTS[c.el].polarity; }

export interface State {
  stock: Card[];      // feed battery (face down)
  waste: Card[];      // buffer (face up, top = last)
  cores: Card[][];    // 4 foundations, indexed by element id
  conduits: Card[][]; // 7 tableau columns
  draw: 1 | 3;        // difficulty toggle
  score: number;
  moves: number;
  time: number;       // seconds elapsed
  combo: number;      // consecutive core deliveries
  redeals: number;    // times the feed battery was recycled
  won: boolean;
}

// --- move descriptors --------------------------------------------------------

export type Source =
  | { kind: 'waste' }
  | { kind: 'core'; i: number }
  | { kind: 'conduit'; i: number; start: number };

export type Dest =
  | { kind: 'core'; i: number }
  | { kind: 'conduit'; i: number };

export interface MoveOutcome {
  ok: boolean;
  toCore: boolean;
  revealed: boolean;
  gained: number;
  combo: number;
}

const clone = (s: State): State =>
  (typeof structuredClone === 'function'
    ? structuredClone(s)
    : JSON.parse(JSON.stringify(s)));

// --- scoring -----------------------------------------------------------------

const SCORE = {
  toCore: 100,
  comboStep: 50,      // bonus per active combo level
  reveal: 50,
  wasteToConduit: 10,
  conduitToConduit: 5,
  corePull: -120,     // pulling a cell back out of a core
};

export class Game {
  state: State;
  private history: State[] = [];
  private redoStack: State[] = [];
  onChange: (() => void) | null = null;

  constructor() {
    this.state = Game.fresh(1);
  }

  static fresh(draw: 1 | 3): State {
    return {
      stock: [], waste: [], cores: [[], [], [], []],
      conduits: [[], [], [], [], [], [], []],
      draw, score: 0, moves: 0, time: 0, combo: 0, redeals: 0, won: false,
    };
  }

  newGame(draw: 1 | 3 = this.state.draw): void {
    const deck: Card[] = [];
    for (let el = 0; el < 4; el += 1)
      for (let rank = 1; rank <= 13; rank += 1)
        deck.push({ id: el * 13 + (rank - 1), el, rank, up: false });
    // Fisher–Yates
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const s = Game.fresh(draw);
    // deal 7 conduits, i+1 cells, last face up
    for (let c = 0; c < 7; c += 1) {
      for (let n = 0; n <= c; n += 1) {
        const card = deck.pop()!;
        card.up = n === c;
        s.conduits[c].push(card);
      }
    }
    for (const card of deck) { card.up = false; s.stock.push(card); }
    this.state = s;
    this.history = [];
    this.redoStack = [];
    this.emit();
  }

  private emit(): void { if (this.onChange) this.onChange(); }
  private pushUndo(): void {
    this.history.push(clone(this.state));
    if (this.history.length > 200) this.history.shift();
    this.redoStack = [];
  }

  canUndo(): boolean { return this.history.length > 0; }
  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.redoStack.push(clone(this.state));
    this.state = prev;
    this.emit();
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.history.push(clone(this.state));
    this.state = next;
    this.emit();
    return true;
  }

  // --- queries ---------------------------------------------------------------

  /** Cards represented by a source, top of stack last (no removal). */
  cardsOf(src: Source): Card[] {
    const s = this.state;
    if (src.kind === 'waste') return s.waste.length ? [s.waste[s.waste.length - 1]] : [];
    if (src.kind === 'core') { const p = s.cores[src.i]; return p.length ? [p[p.length - 1]] : []; }
    return s.conduits[src.i].slice(src.start);
  }

  /** A conduit run starting at `start` is grabbable iff every cell is face up
   *  and forms a descending, alternating-polarity sequence. */
  isMovableRun(i: number, start: number): boolean {
    const col = this.state.conduits[i];
    if (start < 0 || start >= col.length) return false;
    for (let k = start; k < col.length; k += 1) {
      if (!col[k].up) return false;
      if (k > start) {
        const a = col[k - 1], b = col[k];
        if (a.rank !== b.rank + 1) return false;
        if (polarityOf(a) === polarityOf(b)) return false;
      }
    }
    return true;
  }

  canDropOnCore(i: number, card: Card): boolean {
    if (card.el !== i) return false;            // each core takes one element
    const core = this.state.cores[i];
    return core.length === 0 ? card.rank === 1 : core[core.length - 1].rank === card.rank - 1;
  }

  canDropOnConduit(i: number, card: Card): boolean {
    const col = this.state.conduits[i];
    if (col.length === 0) return card.rank === 13;        // empty takes a 13 only
    const top = col[col.length - 1];
    if (!top.up) return false;
    return top.rank === card.rank + 1 && polarityOf(top) !== polarityOf(card);
  }

  canMove(src: Source, dest: Dest): boolean {
    const cards = this.cardsOf(src);
    if (!cards.length) return false;
    if (src.kind === 'conduit' && !this.isMovableRun(src.i, src.start)) return false;
    if (dest.kind === 'core') {
      if (cards.length !== 1) return false;
      if (src.kind === 'core' && src.i === dest.i) return false;
      return this.canDropOnCore(dest.i, cards[0]);
    }
    // conduit dest
    if (src.kind === 'conduit' && src.i === dest.i) return false;
    return this.canDropOnConduit(dest.i, cards[0]);
  }

  // --- mutation --------------------------------------------------------------

  private remove(src: Source): Card[] {
    const s = this.state;
    if (src.kind === 'waste') return s.waste.splice(s.waste.length - 1, 1);
    if (src.kind === 'core') return s.cores[src.i].splice(s.cores[src.i].length - 1, 1);
    return s.conduits[src.i].splice(src.start);
  }

  /** Reveal the now-top encrypted cell of a conduit; returns true if one flipped. */
  private revealTop(i: number): boolean {
    const col = this.state.conduits[i];
    if (col.length && !col[col.length - 1].up) { col[col.length - 1].up = true; return true; }
    return false;
  }

  move(src: Source, dest: Dest, record = true): MoveOutcome {
    const fail: MoveOutcome = { ok: false, toCore: false, revealed: false, gained: 0, combo: this.state.combo };
    if (!this.canMove(src, dest)) return fail;
    if (record) this.pushUndo();
    const s = this.state;
    const cards = this.remove(src);
    if (dest.kind === 'core') s.cores[dest.i].push(...cards);
    else s.conduits[dest.i].push(...cards);

    const revealed = src.kind === 'conduit' ? this.revealTop(src.i) : false;

    // scoring + combo (pure juice; does not affect legality)
    let gained = 0;
    if (dest.kind === 'core') {
      s.combo += 1;
      gained += SCORE.toCore + (s.combo - 1) * SCORE.comboStep;
    } else {
      s.combo = 0;
      if (src.kind === 'waste') gained += SCORE.wasteToConduit;
      else if (src.kind === 'core') gained += SCORE.corePull;
      else gained += SCORE.conduitToConduit;
    }
    if (revealed) gained += SCORE.reveal;

    s.score = Math.max(0, s.score + gained);
    s.moves += 1;
    this.checkWin();
    this.emit();
    return { ok: true, toCore: dest.kind === 'core', revealed, gained, combo: s.combo };
  }

  /** Draw from the feed battery to the buffer, or recycle when empty. */
  draw(): boolean {
    const s = this.state;
    if (s.stock.length === 0 && s.waste.length === 0) return false;
    this.pushUndo();
    if (s.stock.length === 0) {
      // recycle buffer back into the battery (reversed, encrypted)
      while (s.waste.length) { const c = s.waste.pop()!; c.up = false; s.stock.push(c); }
      s.redeals += 1;
    } else {
      const n = Math.min(s.draw, s.stock.length);
      for (let k = 0; k < n; k += 1) { const c = s.stock.pop()!; c.up = true; s.waste.push(c); }
    }
    s.combo = 0;
    s.moves += 1;
    this.emit();
    return true;
  }

  /** Try to send a specific card (must be a top/grabbable single) to its core. */
  sendToCore(src: Source): MoveOutcome {
    const cards = this.cardsOf(src);
    if (cards.length !== 1) {
      // for a conduit, only the very top card can go to a core
      if (src.kind === 'conduit') {
        const col = this.state.conduits[src.i];
        return this.move({ kind: 'conduit', i: src.i, start: col.length - 1 }, { kind: 'core', i: col[col.length - 1]?.el ?? 0 });
      }
      return { ok: false, toCore: false, revealed: false, gained: 0, combo: this.state.combo };
    }
    return this.move(src, { kind: 'core', i: cards[0].el });
  }

  /** One safe autoplay step: move any available cell onto a core. */
  autoOne(): boolean {
    const s = this.state;
    // waste top
    if (s.waste.length) {
      const c = s.waste[s.waste.length - 1];
      if (this.canDropOnCore(c.el, c)) return this.move({ kind: 'waste' }, { kind: 'core', i: c.el }).ok;
    }
    // conduit tops
    for (let i = 0; i < 7; i += 1) {
      const col = s.conduits[i];
      if (!col.length) continue;
      const c = col[col.length - 1];
      if (c.up && this.canDropOnCore(c.el, c))
        return this.move({ kind: 'conduit', i, start: col.length - 1 }, { kind: 'core', i: c.el }).ok;
    }
    return false;
  }

  autoAll(): number {
    let n = 0;
    while (this.autoOne()) n += 1;
    return n;
  }

  /** All cells face up and stock/waste empty → the board can be auto-finished. */
  canAutoFinish(): boolean {
    const s = this.state;
    if (s.stock.length || s.waste.length) return false;
    for (const col of s.conduits) for (const c of col) if (!c.up) return false;
    return true;
  }

  private checkWin(): void {
    const total = this.state.cores.reduce((a, c) => a + c.length, 0);
    if (total === 52) this.state.won = true;
  }

  // --- persistence -----------------------------------------------------------

  serialize(): State { return clone(this.state); }
  load(data: any): boolean {
    if (!data || !Array.isArray(data.conduits) || data.conduits.length !== 7) return false;
    if (!Array.isArray(data.cores) || data.cores.length !== 4) return false;
    const total =
      (data.stock?.length || 0) + (data.waste?.length || 0) +
      data.cores.reduce((a: number, c: Card[]) => a + c.length, 0) +
      data.conduits.reduce((a: number, c: Card[]) => a + c.length, 0);
    if (total !== 52) return false;
    this.state = clone(data);
    this.history = [];
    this.redoStack = [];
    this.emit();
    return true;
  }
}
