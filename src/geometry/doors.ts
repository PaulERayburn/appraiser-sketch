/**
 * Doors: floor-plan symbols set in an area's walls (outline or interior).
 * Like stairs and interior walls they are drawing only and never change an
 * area figure. The symbols follow the usual plan conventions, as CValR
 * Sketch draws them from a scan: a leaf and the quarter circle it sweeps, a
 * pair, sliding panels, a pocket, a bifold, an overhead (garage) door, or a
 * plain cased opening.
 */

import type { Path, Point } from "./path.js";

export type DoorStyle = "swing" | "double" | "sliding" | "pocket" | "bifold" | "overhead" | "opening";

export const DOOR_STYLES: { value: DoorStyle; label: string; width: number }[] = [
  { value: "swing", label: "Swing door", width: 2 + 8 / 12 },
  { value: "double", label: "Double (pair)", width: 5 },
  { value: "sliding", label: "Sliding (patio)", width: 6 },
  { value: "pocket", label: "Pocket", width: 2 + 6 / 12 },
  { value: "bifold", label: "Bifold (closet)", width: 4 },
  { value: "overhead", label: "Overhead (garage)", width: 9 },
  { value: "opening", label: "Cased opening", width: 3 },
];

export interface Door {
  id: string;
  /** Middle of the opening, in world coordinates. */
  at: Point;
  /** Direction of the wall it sits in, degrees counter-clockwise from "right". Its jambs are a (behind) and b (ahead). */
  angle: number;
  width: number;
  style: DoorStyle;
  /** Which jamb a swing or pocket door is hung on. */
  hinge: "a" | "b";
  /** Which side of the wall it opens to: 1 is to the left of a→b. */
  side: 1 | -1;
}

export function defaultDoor(over: Partial<Door> = {}): Door {
  return { id: "", at: { x: 0, y: 0 }, angle: 0, width: 2 + 8 / 12, style: "swing", hinge: "a", side: 1, ...over };
}

export interface DoorSymbol {
  /** The jambs: the stretch of wall the opening takes out. */
  a: Point;
  b: Point;
  /** The leaf, its swing and so on, as lines to stroke. */
  lines: Point[][];
  /** Drawn dashed: a pocket door inside its wall, an overhead door above. */
  dashed: boolean;
}

/** The symbol for a door, in world coordinates. */
export function doorSymbol(d: Door): DoorSymbol {
  const rad = (d.angle * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const n = { x: -u.y * d.side, y: u.x * d.side };
  const L = Math.max(0.5, d.width);
  const a = { x: d.at.x - (u.x * L) / 2, y: d.at.y - (u.y * L) / 2 };
  const b = { x: d.at.x + (u.x * L) / 2, y: d.at.y + (u.y * L) / 2 };
  /** A point `t` along the opening from a, `o` out from the wall on the opening side. */
  const P = (t: number, o: number): Point => ({ x: a.x + u.x * t + n.x * o, y: a.y + u.y * t + n.y * o });
  /** The quarter circle a leaf of length `r` hung at `hinge` sweeps from the closed position at `closed` to open. */
  const sweep = (hinge: Point, closed: Point, r: number): Point[] => {
    const open = { x: hinge.x + n.x * r, y: hinge.y + n.y * r };
    const from = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
    let turn = Math.atan2(open.y - hinge.y, open.x - hinge.x) - from;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const pts: Point[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = from + (turn * k) / 12;
      pts.push({ x: hinge.x + Math.cos(t) * r, y: hinge.y + Math.sin(t) * r });
    }
    return pts;
  };
  const off = 0.15; // sliding and pocket panels sit just off the wall line
  let lines: Point[][] = [];
  let dashed = false;
  switch (d.style) {
    case "swing": {
      const h = d.hinge === "b" ? b : a;
      const e = d.hinge === "b" ? a : b;
      lines = [[h, { x: h.x + n.x * L, y: h.y + n.y * L }], sweep(h, e, L)];
      break;
    }
    case "double": {
      const m = L / 2;
      const mid = P(m, 0);
      lines = [[a, P(0, m)], sweep(a, mid, m), [b, P(L, m)], sweep(b, mid, m)];
      break;
    }
    case "sliding":
      lines = [[P(0, off), P(L * 0.55, off)], [P(L * 0.45, -off), P(L, -off)]];
      break;
    case "pocket":
      // The leaf slid into the wall beyond the hinge-side jamb.
      lines = d.hinge === "b" ? [[P(L * 0.15, off), P(L * 2, off)]] : [[P(-L, off), P(L * 0.85, off)]];
      dashed = true;
      break;
    case "bifold": {
      const k = L * 0.18;
      lines = [[P(0, 0), P(L * 0.125, k), P(L * 0.25, 0)], [P(L, 0), P(L * 0.875, k), P(L * 0.75, 0)]];
      break;
    }
    case "overhead": {
      const o = Math.min(L * 0.12, 1);
      lines = [[P(0, o), P(L, o)]];
      dashed = true;
      break;
    }
    case "opening":
      break;
  }
  return { a, b, lines, dashed };
}

/** The straight walls of a path, as segments (curved walls take no doors). */
export function wallSegments(paths: Path[]): [Point, Point][] {
  return paths.flatMap((p) => p.segments.filter((s) => s.kind === "line").map((s): [Point, Point] => [s.from, s.to]));
}

/**
 * The place on the nearest wall for a door of `width` wanted at `p`: the
 * closest point on a wall within `reach`, moved along it if need be so the
 * whole opening fits on that wall. Null when no wall is near or long enough.
 */
export function snapToWall(p: Point, width: number, walls: [Point, Point][], reach: number): { at: Point; angle: number } | null {
  let best: { at: Point; angle: number; dist: number } | null = null;
  for (const [a, b] of walls) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < width - 1e-9) continue;
    const half = width / 2;
    const t = Math.min(len - half, Math.max(half, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    // How far the wanted point is from the wall itself, not from where the door ends up on it.
    const along = Math.min(len, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
    const dist = Math.hypot(p.x - (a.x + (dx * along) / len), p.y - (a.y + (dy * along) / len));
    if (dist <= reach && (!best || dist < best.dist - 1e-9)) {
      best = { at: { x: a.x + (dx * t) / len, y: a.y + (dy * t) / len }, angle: (Math.atan2(dy, dx) * 180) / Math.PI, dist };
    }
  }
  return best ? { at: best.at, angle: best.angle } : null;
}

/**
 * A door as it should be drawn against the walls as they are now: if a wall
 * it sits in has been nudged, it stays in that wall, keeping the way it
 * faces. Left where it was when no wall is within `reach`.
 */
export function seatDoor(d: Door, walls: [Point, Point][], reach = 1): Door {
  const hit = snapToWall(d.at, d.width, walls, reach);
  if (!hit) return d;
  // Keep its own direction along the wall (a wall can be found running either way).
  const flip = Math.cos(((hit.angle - d.angle) * Math.PI) / 180) < 0;
  return { ...d, at: hit.at, angle: flip ? hit.angle + 180 : hit.angle };
}
