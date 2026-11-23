/**
 * Editing helpers that rewrite an area's vector text: opening an outline at
 * a corner, closing it, and turning "length + arrow key" into a wall.
 */

import { closure, type Point } from "./path.js";
import { formatLength, lengthStyle, parseLength, roundTo } from "./units.js";
import { parseVectors } from "./vectors.js";

/**
 * A length written into a wall token. Unlike the lengths shown on screen it
 * is never rounded to the inch, so an outline that closed before a rewrite
 * still closes after it: whole inches where they fit (24'6"), then sixteenths
 * (24'6-1/2"), then decimal inches (7'0.853"). Decimal feet keep four places.
 */
export function tokenLength(feet: number): string {
  if (lengthStyle() === "decimal") return `${roundTo(feet, 4)}'`;
  const inches = feet * 12;
  if (Math.abs(inches - Math.round(inches)) < 1e-4) {
    // Under a foot reads better as inches alone: 3" rather than 0'3".
    return formatLength(feet).replace(/^0'(?=\d)/, "");
  }
  const sixteenths = Math.round(inches * 16);
  if (Math.abs(inches * 16 - sixteenths) < 1e-3) {
    const ft = Math.floor(sixteenths / 192);
    const rest = sixteenths - ft * 192;
    let num = rest % 16;
    let den = 16;
    while (num % 2 === 0) {
      num /= 2;
      den /= 2;
    }
    return `${ft > 0 ? `${ft}'` : ""}${Math.floor(rest / 16)}-${num}/${den}"`;
  }
  const thousandths = Math.round(inches * 1000);
  const ft = Math.floor(thousandths / 12000);
  return `${ft > 0 ? `${ft}'` : ""}${(thousandths - ft * 12000) / 1000}"`;
}

/** A move token for a wall of (dx, dy) feet, e.g. "R24'", "U30'6\"" or "R10'U5'". */
export function moveToken(dx: number, dy: number): string {
  const tol = 1 / 96;
  const h = Math.abs(dx) > tol ? `${dx > 0 ? "R" : "L"}${tokenLength(Math.abs(dx))}` : "";
  const v = Math.abs(dy) > tol ? `${dy > 0 ? "U" : "D"}${tokenLength(Math.abs(dy))}` : "";
  return h + v;
}

export interface Rewritten {
  vectors: string;
  origin: Point;
  /** Where each wall of the old outline went: its new number, or null if it was removed. */
  walls: (number | null)[];
}

/** Carry hidden-dimension wall numbers through a rewrite, so they stay on the same walls. */
export function remapHiddenDims(hidden: readonly number[] | undefined, walls: readonly (number | null)[]): number[] {
  const out = new Set<number>();
  for (const k of hidden ?? []) {
    const to = walls[k];
    if (to !== null && to !== undefined) out.add(to);
  }
  return [...out].sort((a, b) => a - b);
}

/** Corners of an outline in drawing order (start first). */
export function corners(vectors: string, origin: Point): Point[] {
  const { path } = parseVectors(vectors, origin);
  const pts = [path.start, ...path.segments.map((s) => s.to)];
  if (pts.length > 1 && closure(path).closed) pts.pop();
  return pts;
}

/**
 * Open a closed outline at corner `i`: the wall leaving that corner is
 * removed and the walls are reordered so the outline now ends at that corner
 * (where you carry on drawing) and starts at the far end of the removed wall.
 * Typing walls back to the start closes it again. Returns null if the outline
 * isn't closed or the corner doesn't exist.
 *
 * Bad tokens and comments are dropped; a wall made by CL becomes an explicit move.
 */
export function openAtCorner(vectors: string, origin: Point, i: number): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const n = path.segments.length;
  if (n < 3 || !closure(path).closed || i < 0 || i >= n) return null;
  const tokens = path.segments.map((s, k) => sources[k] ?? moveToken(s.to.x - s.from.x, s.to.y - s.from.y));
  const order = [...tokens.slice(i + 1), ...tokens.slice(0, i)];
  const walls = tokens.map((_, k) => (k === i ? null : k > i ? k - i - 1 : n - 1 - i + k));
  return { vectors: order.join(" "), origin: { ...path.segments[i]!.to }, walls };
}

/**
 * Delete a wall, stepping the pen back. On an open outline the last wall goes
 * and the pen moves back to the corner before it (press again to keep going
 * back). On a closed outline, `corner` picks where to open it: the wall
 * leaving that corner goes and the pen sits on the corner. A closing CL/A is
 * removed first, leaving the outline open where it ended.
 */
export function deleteWall(vectors: string, origin: Point, corner: number | null): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const n = path.segments.length;
  if (n === 0) return null;
  if (closure(path).closed && n >= 3) {
    if (corner !== null) return openAtCorner(vectors, origin, corner);
    // No corner picked: open at the end (remove the closing wall).
    return openAtCorner(vectors, origin, n - 1);
  }
  const tokens = path.segments.map((s, k) => sources[k] ?? moveToken(s.to.x - s.from.x, s.to.y - s.from.y));
  tokens.pop();
  return { vectors: tokens.join(" "), origin: { ...path.start }, walls: path.segments.map((_, k) => (k < n - 1 ? k : null)) };
}

/** Close an open outline with a straight wall back to the start. */
export function closeOutline(vectors: string): string {
  const t = vectors.replace(/\s+$/, "");
  return t === "" ? t : `${t} CL`;
}

/**
 * If the text before the caret ends with a bare length ("30", "24'6\""),
 * replace it with a move in the arrow's direction and a trailing space.
 * Returns the new text and caret position, or null to let the arrow key do
 * its normal job.
 */
export function applyArrow(text: string, caret: number, dir: "up" | "down" | "left" | "right"): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s,])([0-9][0-9.'"\-/]*)$/.exec(before);
  if (!m) return null;
  const len = m[2]!;
  const letter = { up: "U", down: "D", left: "L", right: "R" }[dir];
  const start = before.length - len.length;
  const insert = `${letter}${len} `;
  const after = text.slice(caret).replace(/^ /, "");
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length };
}

/**
 * If the text before the caret ends with a bare direction ("L", "U"), with
 * nothing after it, replace it with a wall in that direction that runs until
 * it lines up with the next corner already drawn: "L" from the far side of a
 * house stops straight above or below the nearest corner to its left. A
 * second bare direction the same way carries the same wall on to the corner
 * after that. Returns the new text (ending on a new line) and caret position,
 * or null when there is no bare direction or no corner that way.
 */
export function skipToCorner(text: string, caret: number, origin: Point): { text: string; caret: number } | null {
  if (text.slice(caret).trim() !== "") return null;
  const before = text.slice(0, caret);
  const m = /(^|[\s,])([lrud])$/i.exec(before);
  if (!m) return null;
  if (/#[^\n]*$/.test(before)) return null; // inside a # comment
  let head = before.slice(0, -1);
  const { path, sources } = parseVectors(head, origin);
  if (path.segments.length > 0 && closure(path).closed) return null;
  const pts = [path.start, ...path.segments.map((s) => s.to)];
  const pen = pts[pts.length - 1]!;
  const letter = m[2]!.toUpperCase() as "L" | "R" | "U" | "D";
  const horizontal = letter === "L" || letter === "R";
  const sign = letter === "R" || letter === "U" ? 1 : -1;
  const tol = 1 / 96;
  // How far that way each other corner is; the nearest one ahead is the stop.
  const ahead = pts
    .map((p) => sign * (horizontal ? p.x - pen.x : p.y - pen.y))
    .filter((d) => d > tol);
  if (ahead.length === 0) return null;
  let run = Math.min(...ahead);

  // Carry on a wall already running the same way rather than adding a second one in line with it.
  const last = path.segments[path.segments.length - 1];
  const src = sources[sources.length - 1];
  if (last && src && last.kind === "line") {
    const dx = last.to.x - last.from.x;
    const dy = last.to.y - last.from.y;
    const along = sign * (horizontal ? dx : dy);
    const across = Math.abs(horizontal ? dy : dx);
    const at = head.trimEnd().length - src.length;
    if (along > tol && across < tol && at >= 0 && head.slice(at).trimEnd() === src) {
      run += along;
      head = head.slice(0, at);
    }
  }
  const token = horizontal ? moveToken(sign * run, 0) : moveToken(0, sign * run);
  const out = `${head}${token}\n`;
  return { text: out, caret: out.length };
}

/**
 * Move corners of an outline by (dx, dy) and rewrite the walls to match: the
 * wall arriving at a moved corner and the wall leaving it change; everything
 * else keeps its typed text. Moving both ends of one wall slides that wall.
 * Corner k is the start of wall k (corner 0 is the start point; on an open
 * outline the last corner is the pen). Arcs keep their depth. A wall that
 * shrinks to nothing is dropped. Comments are dropped.
 */
export function moveCorners(vectors: string, origin: Point, cornerIdx: number[], d: Point): Rewritten | null {
  const { path, sources } = parseVectors(vectors, origin);
  const segs = path.segments;
  const n = segs.length;
  if (n === 0) return null;
  const closed = closure(path).closed;
  const count = closed ? n : n + 1;
  const moved = new Set(cornerIdx.filter((c) => c >= 0 && c < count));
  if (moved.size === 0) return null;

  const delta = segs.map((s) => ({ x: s.to.x - s.from.x, y: s.to.y - s.from.y }));
  const changed = new Set<number>();
  const bump = (k: number, sign: 1 | -1) => {
    delta[k]!.x += sign * d.x;
    delta[k]!.y += sign * d.y;
    changed.add(k);
  };
  for (const c of moved) {
    const arriving = c > 0 ? c - 1 : closed ? n - 1 : -1;
    if (arriving >= 0) bump(arriving, 1);
    if (c < n) bump(c, -1);
  }
  // Moving the start point moves the whole outline's anchor.
  const newOrigin = moved.has(0) ? { x: origin.x + d.x, y: origin.y + d.y } : { ...origin };

  const tokens: string[] = [];
  const walls: (number | null)[] = segs.map(() => null);
  const keep = (k: number, token: string) => {
    walls[k] = tokens.length;
    tokens.push(token);
  };
  segs.forEach((s, k) => {
    const src = sources[k] ?? null;
    if (src === null) {
      // A wall made by CL/A: keep closing (it follows the corners by itself).
      const t = k === n - 1 ? "CL" : moveToken(delta[k]!.x, delta[k]!.y);
      if (t !== "") keep(k, t);
      return;
    }
    const same = Math.abs(delta[k]!.x - (s.to.x - s.from.x)) < 1e-9 && Math.abs(delta[k]!.y - (s.to.y - s.from.y)) < 1e-9;
    if (!changed.has(k) || same) {
      keep(k, src);
      return;
    }
    const t = moveToken(delta[k]!.x, delta[k]!.y);
    if (t === "") return; // wall shrank to nothing
    const arc = s.kind === "arc" ? /\^.*$/.exec(src)?.[0] ?? "" : "";
    keep(k, t + arc);
  });
  // A closing wall that shrank to nothing leaves "CL" with no wall behind it.
  const made = parseVectors(tokens.join(" "), newOrigin).path.segments.length;
  for (let k = 0; k < n; k++) if (walls[k] !== null && walls[k]! >= made) walls[k] = null;
  return { vectors: tokens.join(" "), origin: newOrigin, walls };
}

/**
 * Lengthen or shorten the wall just before the caret ("R24 " → "R24'1\" ")
 * with an arrow along it: the wall's own direction adds `step`, the opposite
 * takes it away. Only plain straight moves (R/L/U/D + a length); returns null
 * for anything else, a crosswise arrow, or a wall that would shrink to nothing.
 */
export function adjustLastWall(
  text: string,
  caret: number,
  dir: "up" | "down" | "left" | "right",
  step: number,
): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s,])([UDLRudlr])([0-9][^\s,]*)(\s*)$/.exec(before);
  if (!m) return null;
  const letter = m[2]!.toUpperCase();
  const len = parseLength(m[3]!);
  if (len === null) return null;
  const axis = letter === "L" || letter === "R" ? "h" : "v";
  if ((axis === "h") !== (dir === "left" || dir === "right")) return null;
  const same = { up: "U", down: "D", left: "L", right: "R" }[dir] === letter;
  const next = Math.round((len + (same ? step : -step)) * 9600) / 9600;
  if (next < step / 2) return null;
  const tok = `${letter}${moveToken(next, 0).slice(1)}`;
  const start = before.length - m[2]!.length - m[3]!.length - m[4]!.length;
  const after = text.slice(caret).replace(/^ /, "");
  const insert = `${tok} `;
  return { text: text.slice(0, start) + insert + after, caret: start + insert.length };
}
