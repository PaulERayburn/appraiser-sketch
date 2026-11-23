/**
 * A self-contained SVG of the sketch for print, PDF and PNG: black lines on
 * white, no grid or editing marks, scaled to fit the given box, with its own
 * styles so it looks the same whatever the screen theme.
 */

import { bounds, flatten, showsDetail, stairDrawing, type Bounds, type SketchResult } from "../geometry/index.js";
import { labelPoint, renderSketch, type View } from "../app/render.js";

/** Print styles; text sizes are the screen's, times `k`, so labels keep their place relative to the walls. */
const style = (k: number) => {
  const px = (v: number) => `${(v * k).toFixed(2)}px`;
  return `
text { font-family: Arial, Helvetica, sans-serif; }
.area { stroke: #111; stroke-width: 1.5; fill: #fff; stroke-linejoin: round; }
.area.kind-deck { stroke-dasharray: 6 4; }
.area.has-problems { stroke: #b3261e; }
.area.unclosed, .area.unclosed.has-problems { stroke: none; }
.area-walls { fill: none; stroke: #111; stroke-width: 1.5; stroke-linejoin: round; }
.area-walls.kind-deck { stroke-dasharray: 6 4; }
.area-walls.has-problems { stroke: #b3261e; }
.zone { fill: none; stroke: #777; stroke-width: 0.8; stroke-dasharray: 3 3; }
.zone-low { fill: #ececec; }
.zone-reduced { fill: #f6f6f6; }
.zone-label { font-size: ${px(10)}; font-style: italic; fill: #444; }
.zone-opening { fill: #fbeaea; }
.zone-part { stroke: none; }
.zone-part.zone-full { fill: none; }
.zone-sloped { fill: none; }
.iwall { fill: none; stroke: #111; stroke-width: 1; stroke-linecap: square; }
.wall-band { fill: #8a8a8a; stroke: #111; stroke-width: 0.6; }
.iwall.thick { stroke: #8a8a8a; stroke-linecap: butt; stroke-linejoin: miter; }
.door-gap { stroke: #fff; stroke-width: 3; }
.door-leaf { fill: none; stroke: #111; stroke-width: 0.8; }
.door-leaf.dashed { stroke-dasharray: 4 3; }
.stair { fill: #fff; stroke: #111; stroke-width: 1; }
.tread { stroke: #666; stroke-width: 0.7; }
.stair-arrow { fill: none; stroke: #111; stroke-width: 1; }
.stair-head { fill: #111; }
.stair-label { font-size: ${px(9)}; font-weight: bold; fill: #111; text-anchor: middle; dominant-baseline: middle; }
.misclosure { stroke: #b3261e; stroke-width: 1.2; stroke-dasharray: 4 3; }
.labels text { fill: #111; text-anchor: middle; dominant-baseline: middle; paint-order: stroke; stroke: #fff; stroke-width: ${px(3)}; stroke-linejoin: round; }
.dim { fill: #333; font-size: ${px(11)}; }
.area-name { font-size: ${px(12)}; font-weight: bold; }
.area-size { font-size: ${px(11)}; fill: #333; }
.room-label { font-size: ${px(12)}; fill: #111; }
`;
};

/** Bounds of everything drawn: outlines, stairs and moved labels. */
export function drawingBounds(result: SketchResult): Bounds | null {
  let b: Bounds | null = null;
  const add = (x: number, y: number) => {
    b = b
      ? { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  };
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.shape.path.segments.length === 0) continue;
      const ab = bounds(a.shape.path);
      add(ab.minX, ab.minY);
      add(ab.maxX, ab.maxY);
      if (showsDetail(result.sketch)) for (const st of a.area.stairs ?? []) for (const p of stairDrawing(st).parts.flat()) add(p.x, p.y);
      if (flatten(a.shape.path).length >= 3) {
        const lp = labelPoint(a);
        add(lp.x, lp.y);
      }
    }
  }
  for (const t of result.sketch.texts ?? []) add(t.at.x, t.at.y);
  return b;
}

/** Scale so the drawing fits the box, leaving room for dimension text; never larger than `maxScale` px/ft. */
export function fitView(b: Bounds, width: number, height: number, pad = 28, maxScale = 30): View {
  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, maxScale);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { scale, ox: width / 2 - cx * scale, oy: height / 2 + cy * scale };
}

/**
 * `screenScale` is the on-screen zoom (px per foot). Text is then sized in
 * the same proportion to the building as on screen, so labels you placed
 * stay where you put them; small, but never below half the screen size.
 */
export function standaloneSvg(result: SketchResult, width: number, height: number, screenScale?: number): string {
  const b = drawingBounds(result);
  const view = b ? fitView(b, width, height) : { scale: 10, ox: width / 2, oy: height / 2 };
  const k = screenScale && screenScale > 0 ? Math.min(1.5, Math.max(0.5, view.scale / screenScale)) : 1;
  const svg = renderSketch(result, { width, height, view, selection: null, grid: false, interactive: false, textScale: k });
  return svg.replace(/^<svg([^>]*)>/, `<svg$1><style>${style(k)}</style><rect width="100%" height="100%" fill="#fff"/>`);
}
