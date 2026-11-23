/**
 * Wall thickness, for the look of the drawing only. Outlines are measured to
 * the outside face (ANSI Z765), so an outside wall's thickness is drawn
 * inward from the outline and an interior wall's is centred on its line.
 * Nothing here changes an area figure.
 */

import type { AreaKind } from "./ansi.js";
import type { Point } from "./path.js";

/** Usual thicknesses, in inches: framing plus drywall inside and stucco or siding outside. */
export const WALL_PRESETS: { value: string; label: string; exterior: number; interior: number }[] = [
  { value: "2x4", label: '2x4 framing, about 6"', exterior: 6, interior: 4.5 },
  { value: "2x6", label: '2x6 framing, about 8"', exterior: 8, interior: 4.5 },
];

/** Areas that have walls to draw: a deck, porch, patio or carport is open. */
export function hasWalls(kind: AreaKind): boolean {
  return kind === "living" || kind === "garage" || kind === "other";
}

/**
 * The inside face of an outline's walls: the polygon `t` in from every side.
 * `poly` is the outline's corners in order, either way round. Null when the
 * outline is too small or too thin for walls that thick.
 */
export function insetPolygon(poly: Point[], t: number): Point[] | null {
  // Drop repeated points (a closing point, or a zero-length wall).
  const pts = poly.filter((p, i) => {
    const q = poly[(i + poly.length - 1) % poly.length]!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
  if (pts.length < 3 || !(t > 0)) return null;
  const signed = (ps: Point[]) => ps.reduce((a, p, i) => a + p.x * ps[(i + 1) % ps.length]!.y - ps[(i + 1) % ps.length]!.x * p.y, 0) / 2;
  const area = signed(pts);
  if (Math.abs(area) < 1e-9) return null;
  const turn = area > 0 ? 1 : -1; // counter-clockwise: inside is to the left of each wall
  const n = pts.length;
  const dir = pts.map((p, i) => {
    const q = pts[(i + 1) % n]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  });
  const inward = dir.map((d) => ({ x: -d.y * turn, y: d.x * turn }));
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const k = (i + n - 1) % n; // the wall arriving at this corner
    const d0 = dir[k]!;
    const d1 = dir[i]!;
    const a = { x: p.x + inward[k]!.x * t, y: p.y + inward[k]!.y * t };
    const b = { x: p.x + inward[i]!.x * t, y: p.y + inward[i]!.y * t };
    const cross = d0.x * d1.y - d0.y * d1.x;
    if (Math.abs(cross) < 1e-9) {
      out.push(b); // walls in line
      continue;
    }
    // Where the two inside faces meet.
    const s = ((b.x - a.x) * d1.y - (b.y - a.y) * d1.x) / cross;
    let c = { x: a.x + d0.x * s, y: a.y + d0.y * s };
    // A very sharp corner would throw the point far off: hold it within a few thicknesses.
    const reach = Math.hypot(c.x - p.x, c.y - p.y);
    if (reach > 4 * t) c = { x: p.x + ((c.x - p.x) * 4 * t) / reach, y: p.y + ((c.y - p.y) * 4 * t) / reach };
    out.push(c);
  }
  // Walls thicker than the room: nothing left inside, or it has turned inside out.
  const left = signed(out);
  if (left * turn <= 1e-6 || Math.abs(left) >= Math.abs(area)) return null;
  return out;
}
