/** Copying areas and stairs between floors. */

import { computeShape, containsPoint, type Area } from "./model.js";
import { area as pathArea, flatten, type Point } from "./path.js";
import { stairDrawing, type Stair } from "./stairs.js";

/**
 * Order of levels from the bottom: basement, 1, 2, … then attic. Split-level
 * names fit in: lower with the basement, main as 1, upper half a floor up
 * (any number works too, e.g. 1.5).
 */
export function levelRank(level: string): number {
  const l = level.trim().toLowerCase();
  if (l.startsWith("base") || l === "b" || l.startsWith("lower")) return -1;
  if (l.startsWith("main") || l.startsWith("entry")) return 1;
  if (l.startsWith("upper")) return 1.5;
  if (l.startsWith("attic")) return 99;
  const n = Number.parseFloat(l);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A copy of an area placed with its start point at `origin`. Its stairs,
 * ceiling zones and interior walls come along (new ids, same place relative to the outline);
 * `over` then sets the new area's name, type, level and so on.
 */
export function copyArea(src: Area, origin: Point, newId: (prefix: string) => string, over: Partial<Area> = {}): Area {
  const dx = origin.x - src.origin.x;
  const dy = origin.y - src.origin.y;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const copy: Area = structuredClone(src);
  copy.id = newId("a");
  copy.name = `${src.name} (copy)`;
  copy.origin = { ...origin };
  copy.zones = copy.zones.map((z) => ({ ...z, id: newId("z"), origin: shift(z.origin) }));
  copy.stairs = (copy.stairs ?? []).map((s) => ({ ...s, id: newId("st"), origin: shift(s.origin) }));
  if (copy.walls) copy.walls = copy.walls.map((w) => ({ ...w, id: newId("w"), origin: shift(w.origin) }));
  if (copy.doors) copy.doors = copy.doors.map((d) => ({ ...d, id: newId("d"), at: shift(d.at) }));
  return { ...copy, ...over, id: copy.id };
}

/**
 * A copy of a stair for another area: same place relative to that area's start
 * point (so floors drawn from the same corner line up), and the arrow pointing
 * the way you'd go from that floor (down from a floor above, up from below).
 */
export function copyStairTo(st: Stair, from: Area, to: Area, id: string): Stair {
  const rel = { x: st.origin.x - from.origin.x, y: st.origin.y - from.origin.y };
  const a = levelRank(from.level);
  const b = levelRank(to.level);
  const direction = to.id === from.id || a === b ? st.direction : b > a ? "down" : "up";
  return { ...structuredClone(st), id, origin: { x: to.origin.x + rel.x, y: to.origin.y + rel.y }, direction };
}

/**
 * Which area a stair belongs in once it has been dragged: the area it was
 * in if it is still inside that outline, otherwise another area of the same
 * structure that holds the whole stair (a living area first, then the
 * smallest). Null means leave it where it is.
 */
export function stairHome(areas: Area[], fromId: string, st: Stair): string | null {
  const pts = stairDrawing(st).parts.flat();
  const holds = (a: Area) => {
    const outline = flatten(computeShape(a.vectors, a.origin).path);
    return outline.length >= 3 && pts.every((p) => containsPoint(outline, p));
  };
  const from = areas.find((a) => a.id === fromId);
  if (from && holds(from)) return null;
  const size = (a: Area) => Math.abs(pathArea(computeShape(a.vectors, a.origin).path));
  const best = areas
    .filter((a) => a.id !== fromId && holds(a))
    .sort((a, b) => Number(b.kind === "living") - Number(a.kind === "living") || size(a) - size(b))[0];
  return best ? best.id : null;
}
