/**
 * A stair built from steps, written the way it is walked:
 *
 *   2u sq r8          2 steps up the screen, a square landing, 8 steps right
 *   2u rad 90 3rise   2 steps up, then a 90° corner of 3 pie-shaped steps
 *   6u sq r sq d6     a U: up, a double landing, back down
 *
 * Pieces, separated by spaces:
 *   3u, u3            a flight of 3 steps (u, d, l, r as on the screen)
 *   u4'6              a flight 4'6" long
 *   sq                a square landing, as wide as the stair
 *   rad, rad 3rise    a 90° corner of winders (3 unless given); rad 180 turns right round
 *   l, r, u, d        on a landing: turn to face that way; after rad: which way it turns
 *
 * Plain words work too: "2 steps up, square landing, 8 to the right".
 * A stair never changes an area figure; this only builds its drawing.
 */

import type { Point } from "./path.js";
import { parseLength } from "./units.js";

/** Tread depth for the symbol: 10". */
const TREAD = 10 / 12;

export interface StairPlan {
  /** Flights, landings and winder corners, each a closed polygon. */
  parts: Point[][];
  /** Tread and winder lines. */
  lines: [Point, Point][];
  /** The walking line, start to head. */
  arrow: Point[];
  /** Plan footprint, sq ft. */
  footprint: number;
  /** Steps in all: flight treads and winders. */
  steps: number;
  /** What could not be read, in plain words. */
  errors: string[];
}

type Dir = "u" | "d" | "l" | "r";
const VEC: Record<Dir, Point> = { u: { x: 0, y: 1 }, d: { x: 0, y: -1 }, l: { x: -1, y: 0 }, r: { x: 1, y: 0 } };
const WORD: Record<string, Dir> = { u: "u", d: "d", l: "l", r: "r", up: "u", down: "d", left: "l", right: "r" };
const FILLER = new Set(["st", "stair", "stairs", "step", "steps", "to", "the", "a", "an", "then", "and", "of", "with", "rise", "rises", "riser", "risers"]);

type Op =
  | { kind: "flight"; dir: Dir; length: number; steps: number }
  | { kind: "landing" }
  | { kind: "winder"; steps: number; angle: 90 | 180 }
  | { kind: "turn"; dir: Dir };

function readOps(plan: string, errors: string[]): Op[] {
  const tokens = plan
    .toLowerCase()
    .replace(/[’′]/g, "'")
    .replace(/[”″]/g, '"')
    .replace(/[(),;]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => (i === 0 ? t.replace(/^st(?=[0-9udlr])/, "") : t));
  const ops: Op[] = [];
  /** A count waiting for its direction: "2 steps up". */
  let count: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const flight = (dir: Dir, amount: string) => {
      if (/^[0-9]+$/.test(amount)) {
        const n = Number(amount);
        if (n < 1) errors.push(`"${t}": a flight needs at least 1 step`);
        else ops.push({ kind: "flight", dir, length: n * TREAD, steps: n });
        return;
      }
      const len = /['"]/.test(amount) ? parseLength(amount) : null;
      if (len === null || len <= 0) errors.push(`"${t}": not a number of steps or a length`);
      else ops.push({ kind: "flight", dir, length: len, steps: Math.max(1, Math.round(len / TREAD)) });
    };
    let m: RegExpExecArray | null;
    if (FILLER.has(t)) continue;
    if (/^[0-9]+$/.test(t)) {
      count = Number(t);
    } else if (t in WORD) {
      const dir = WORD[t]!;
      if (count !== null) flight(dir, String(count));
      else ops.push({ kind: "turn", dir });
      count = null;
    } else if (t === "sq" || t === "square" || t === "land" || t === "landing") {
      // "square landing" is one landing.
      if (!((t === "landing" || t === "land") && (tokens[i - 1] === "square" || tokens[i - 1] === "sq"))) ops.push({ kind: "landing" });
      count = null;
    } else if ((m = /^(?:rad|radius|radial|wind|winder|winders|pie)([0-9]*)$/.exec(t))) {
      let angle: 90 | 180 = 90;
      let steps = 3;
      const take = (num: number, isRise: boolean) => {
        if (!isRise && (num === 90 || num === 180)) angle = num;
        else if (!isRise && num >= 45) errors.push(`"${num}": a winder corner turns 90 or 180`);
        else if (num >= 1) steps = num;
      };
      if (m[1]) take(Number(m[1]), false);
      // Numbers that follow belong to the corner: "rad 90 3rise", "rad 3".
      for (let j = i + 1; j < tokens.length; j++) {
        const r = /^([0-9]+)(rise|rises|riser|risers)?$/.exec(tokens[j]!);
        if (!r) break;
        const after = tokens[j + 1] ?? "";
        const rise = r[2] !== undefined || /^rise/.test(after);
        const num = Number(r[1]);
        // A count before a direction is the next flight: "rad 6 up" is a corner, then 6 steps up.
        if (!rise && num !== 90 && num !== 180 && (after in WORD || after === "step" || after === "steps")) break;
        take(num, rise);
        i = j;
      }
      ops.push({ kind: "winder", steps, angle });
      count = null;
    } else if ((m = /^([0-9][0-9.'"\-/]*)([udlr])$/.exec(t)) || (m = /^([udlr])([0-9][0-9.'"\-/]*)$/.exec(t))) {
      const dirFirst = /^[udlr]/.test(t);
      flight((dirFirst ? m[1] : m[2]) as Dir, (dirFirst ? m[2] : m[1])!);
      count = null;
    } else {
      errors.push(`"${t}": not a step, landing (sq), winder (rad) or direction`);
      count = null;
    }
  }
  if (count !== null) errors.push(`"${count}": which way? (for example ${count}u)`);
  return ops;
}

const add = (p: Point, v: Point, k: number): Point => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const neg = (v: Point): Point => ({ x: -v.x, y: -v.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
/** The direction to the right of `v` when walking along it. */
const rightOf = (v: Point): Point => ({ x: v.y, y: -v.x });

function shoelace(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Build the stair. The first flight starts with its near edge on the origin,
 * as the other stair types do: heading up the screen it covers x 0..width.
 */
export function stairPlan(plan: string, width: number): StairPlan {
  const errors: string[] = [];
  const ops = readOps(plan, errors);
  const w = Math.max(0.5, width);
  const parts: Point[][] = [];
  const lines: [Point, Point][] = [];
  const arrow: Point[] = [];
  let steps = 0;

  /** Heading, and the middle of the edge the next piece starts from. */
  let d: Point | null = null;
  let c: Point = { x: 0, y: 0 };
  /** The middle of the landing just made, while a turn can still be taken on it. */
  let landing: Point | null = null;
  const inset = Math.min(0.5, TREAD / 2);

  const begin = (dir: Point) => {
    d = dir;
    // Near edge from the origin, running to the right of the heading.
    c = add({ x: 0, y: 0 }, rightOf(dir), w / 2);
    arrow.push(add(c, dir, inset));
  };
  /** A piece `length` deep from the current edge: its corners, near-left first. */
  const box = (dir: Point, length: number): Point[] => {
    const side = rightOf(dir);
    const a = add(c, side, -w / 2);
    const b = add(c, side, w / 2);
    return [a, b, add(b, dir, length), add(a, dir, length)];
  };
  /** Leave a landing or corner by its side, facing `dir`. */
  const turn = (mid: Point, dir: Point) => {
    c = add(mid, dir, w / 2);
    d = dir;
  };
  /** One 90° corner of `n` pie-shaped steps, turning toward `exit`. */
  const corner = (heading: Point, exit: Point, n: number) => {
    parts.push(box(heading, w));
    const mid = add(c, heading, w / 2);
    const inner = add(c, exit, w / 2); // the newel: the inside of the turn
    const back = neg(exit);
    for (let k = 1; k < n; k++) {
      const a = ((Math.PI / 2) * k) / n;
      const reach = w / Math.max(Math.cos(a), Math.sin(a));
      lines.push([inner, add(add(inner, back, Math.cos(a) * reach), heading, Math.sin(a) * reach)]);
    }
    steps += n;
    arrow.push(mid);
    turn(mid, exit);
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.kind === "flight") {
      const dir = VEC[op.dir];
      if (!d) begin(dir);
      const heading: Point = d!;
      if (dot(dir, heading) < 0.5) {
        if (!landing) {
          errors.push(`${op.steps}${op.dir}: add a landing (sq) or winders (rad) before turning`);
          continue;
        }
        if (dot(dir, heading) < -0.5) {
          errors.push(`${op.steps}${op.dir}: to double back, turn across the landing first (sq r sq d…)`);
          continue;
        }
        turn(landing, dir);
      }
      landing = null;
      const poly = box(dir, op.length);
      parts.push(poly);
      for (let k = 1; k < op.steps; k++) {
        const t = (op.length * k) / op.steps;
        lines.push([add(poly[0]!, dir, t), add(poly[1]!, dir, t)]);
      }
      steps += op.steps;
      c = add(c, dir, op.length);
    } else if (op.kind === "landing") {
      if (!d) begin(VEC.u);
      const heading: Point = d!;
      parts.push(box(heading, w));
      landing = add(c, heading, w / 2);
      arrow.push(landing);
      c = add(c, heading, w);
    } else if (op.kind === "turn") {
      const dir = VEC[op.dir];
      if (!d) {
        begin(dir);
      } else if (dot(dir, d) > 0.5) {
        // already facing that way
      } else if (!landing) {
        errors.push(`${op.dir}: a turn needs a landing (sq) or winders (rad) to turn on`);
      } else if (dot(dir, d) < -0.5) {
        errors.push(`${op.dir}: to double back, turn across the landing first (sq r sq d…)`);
      } else {
        turn(landing, dir);
        landing = null;
      }
    } else {
      if (!d) begin(VEC.u);
      const heading: Point = d!;
      // Which way it turns: the way the next piece goes, if that is to one side; else to the right.
      const next = ops[i + 1];
      const want = next && (next.kind === "flight" || next.kind === "turn") ? VEC[next.dir] : null;
      const exit = want && Math.abs(dot(want, heading)) < 0.5 ? want : rightOf(heading);
      landing = null;
      if (op.angle === 90) {
        corner(heading, exit, op.steps);
      } else {
        const first = Math.ceil(op.steps / 2);
        corner(heading, exit, first);
        corner(exit, neg(heading), Math.max(1, op.steps - first));
      }
    }
  }

  // The walking line ends just short of the last flight's far edge (a landing or corner already ends it).
  const end: Point | null = d;
  if (end && ops[ops.length - 1]?.kind === "flight") arrow.push(add(c, end, -inset));
  const footprint = parts.reduce((sum, p) => sum + shoelace(p), 0);
  return { parts, lines, arrow: arrow.length >= 2 ? arrow : [], footprint, steps, errors };
}
