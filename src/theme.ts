/**
 * Visual theme for the reactor skin. Kills the "card grammar" entirely:
 * no suits, pips, court faces or felt — just charge gauges, element glyphs
 * and hot/cold neon. Polarity (the alternation property) reads as warm vs
 * cool light; element type reads as a glyph + accent colour.
 */
import { Graphics } from 'pixi.js';
import { ELEMENTS } from './engine';

export const COLORS = {
  bg: 0x05070d,
  bgGlow: 0x0a1322,
  panel: 0x0d1424,
  panelEdge: 0x1d2a44,
  hot: 0xff6a3d,
  hotDim: 0x5a2418,
  cold: 0x34c6ff,
  coldDim: 0x123246,
  text: 0xdfe9ff,
  textDim: 0x6f87b0,
  cellBack: 0x0b1a2e,
  cellBackEdge: 0x21406a,
  select: 0x6cff8a,
  hint: 0xffe14d,
  win: 0x6cff8a,
};

/** Per-element accent colour (the glyph + a tint), distinct within a polarity. */
export const ELEMENT_ACCENT = [0xff5d5d, 0xffd24d, 0x4dd2ff, 0xb779ff];
export const ELEMENT_GLYPH_NAME = ['Pyron', 'Solis', 'Cryon', 'Aether'];

export function polarityColor(el: number): { hi: number; lo: number } {
  return ELEMENTS[el].polarity === 'hot'
    ? { hi: COLORS.hot, lo: COLORS.hotDim }
    : { hi: COLORS.cold, lo: COLORS.coldDim };
}

/**
 * Draw an element glyph into a Graphics, centred at (cx,cy) with radius r.
 * Each shape is deliberately not card-like.
 */
export function drawGlyph(g: Graphics, el: number, cx: number, cy: number, r: number, color: number, alpha = 1): void {
  const lw = Math.max(1.5, r * 0.16);
  const A = (a: number) => a * alpha;
  switch (el) {
    case 0: { // Pyron — plasma flame (teardrop)
      g.moveTo(cx, cy - r);
      g.bezierCurveTo(cx + r, cy - r * 0.2, cx + r * 0.7, cy + r, cx, cy + r);
      g.bezierCurveTo(cx - r * 0.7, cy + r, cx - r, cy - r * 0.2, cx, cy - r);
      g.fill({ color, alpha: A(0.95) });
      g.circle(cx, cy + r * 0.25, r * 0.34).fill({ color: 0x000000, alpha: A(0.25) });
      break;
    }
    case 1: { // Solis — sun (disc + rays)
      g.circle(cx, cy, r * 0.5).fill({ color, alpha: A(0.95) });
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        const x1 = cx + Math.cos(a) * r * 0.66, y1 = cy + Math.sin(a) * r * 0.66;
        const x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
        g.moveTo(x1, y1).lineTo(x2, y2);
      }
      g.stroke({ width: lw, color, alpha: A(0.95), cap: 'round' });
      break;
    }
    case 2: { // Cryon — snowflake (6 spokes with barbs)
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
        g.moveTo(cx, cy).lineTo(ex, ey);
        const bx = cx + Math.cos(a) * r * 0.6, by = cy + Math.sin(a) * r * 0.6;
        const pa = a + Math.PI / 6, na = a - Math.PI / 6;
        g.moveTo(bx, by).lineTo(bx + Math.cos(pa) * r * 0.28, by + Math.sin(pa) * r * 0.28);
        g.moveTo(bx, by).lineTo(bx + Math.cos(na) * r * 0.28, by + Math.sin(na) * r * 0.28);
      }
      g.stroke({ width: lw, color, alpha: A(0.95), cap: 'round' });
      break;
    }
    default: { // Aether — four-point star (void rift)
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 0.22, cy - r * 0.22);
      g.lineTo(cx + r, cy);
      g.lineTo(cx + r * 0.22, cy + r * 0.22);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r * 0.22, cy + r * 0.22);
      g.lineTo(cx - r, cy);
      g.lineTo(cx - r * 0.22, cy - r * 0.22);
      g.closePath();
      g.fill({ color, alpha: A(0.95) });
      break;
    }
  }
}
