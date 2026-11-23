/**
 * The vector entry language (see docs/SPEC.md §5).
 *
 *   R24 U30 L24'6" D30          cardinal walls (also E N W S)
 *   UR10 / NE10                 45° wall, 10' along the wall
 *   R10U5                       one diagonal wall, run 10 rise 5
 *   A30:12                      12' at 30° counter-clockwise from east
 *   R20^3                       arc bulging 3' outward (^-3 inward)
 *   CL (or A)                   close to the start point
 */

import { parseLength } from "./units.js";
import { CLOSE_TOLERANCE_FT, type Path, type Point, type Segment } from "./path.js";

export interface VectorError {
  /** 0-based index of the token in the input. */
  token: number;
  /** Character offset of the token in the input. */
  offset: number;
  text: string;
  message: string;
}

export interface ParseResult {
  path: Path;
  errors: VectorError[];
  /** The token that made each segment (same order as path.segments); null for a wall added by CL. A turn (10R45) is given as the absolute wall it made (A315:10). */
  sources: (string | null)[];
}

const UNIT: Record<string, Point> = {
  R: { x: 1, y: 0 }, E: { x: 1, y: 0 },
  L: { x: -1, y: 0 }, W: { x: -1, y: 0 },
  U: { x: 0, y: 1 }, N: { x: 0, y: 1 },
  D: { x: 0, y: -1 }, S: { x: 0, y: -1 },
};

const DIAG: Record<string, Point> = {
  UR: { x: 1, y: 1 }, NE: { x: 1, y: 1 },
  UL: { x: -1, y: 1 }, NW: { x: -1, y: 1 },
  DR: { x: 1, y: -1 }, SE: { x: 1, y: -1 },
  DL: { x: -1, y: -1 }, SW: { x: -1, y: -1 },
};

// A length, which may be a sum: 24'6-1/2", 10'6+4'6, 20'6+-10'.
const LEN = String.raw`[0-9][0-9.'"\-/+−]*`;
const CARD = "[RLUDNSEW]";
const DIAGS = "UR|UL|DR|DL|NE|NW|SE|SW";
const ARC = String.raw`(?:\^(-?${LEN}))?`;

const RE_DIAG = new RegExp(`^(${DIAGS})(${LEN})${ARC}$`);
const RE_CARD = new RegExp(`^(${CARD})(${LEN})(?:(${CARD})(${LEN}))?${ARC}$`);
const RE_POLAR = new RegExp(String.raw`^A(-?[0-9]+(?:\.[0-9]+)?):(${LEN})${ARC}$`);

// Length first, as many appraisers write it in the field: 24R, 24'6"U, 10R5U, 10UR, 20R^3.
const RE_LENGTH_FIRST = new RegExp(`^(${LEN}?)(${DIAGS}|${CARD})(?:(${LEN}?)(${CARD}))?(\\^-?${LEN})?$`);

// A length, a direction and a turn in degrees, as CValR Sketch writes an angled wall: 10'6R45.
const RE_TURN = new RegExp(`^(${LEN}?)(${CARD})(-?[0-9]+(?:\\.[0-9]+)?)(\\^-?${LEN})?$`);

// The same turn written direction first, like the A30:12 form: R45:10'6. The colon keeps
// the degrees and the length apart (R10'645 could not be told from 10'6" at 45°).
const RE_TURN_DIR_FIRST = new RegExp(`^(${CARD})(-?[0-9]+(?:\\.[0-9]+)?):(${LEN})(\\^-?${LEN})?$`);

const RE_DEGREES = /^-?[0-9]+(?:\.[0-9]+)?$/;
const RE_SQUARE_DIR_FIRST = new RegExp(`^(${CARD})(${LEN})$`);
const RE_SQUARE_LENGTH_FIRST = new RegExp(`^(${LEN}?)(${CARD})$`);
// Inches typed after a space, with no marks needed: 6, 6.5, 6-1/2 (an inch mark is allowed).
const RE_INCHES = /^[0-9]+(?:\.[0-9]+)?(?:-[0-9]+\/[0-9]+)?"?$/;
const RE_WHOLE = /^[0-9]+$/;
// A + or - standing on its own between two lengths. (Inside a length a hyphen never subtracts.)
const RE_OPERATOR = /^[+\-−]$/;
// One plain length: 3, 3.5, 3'6, 6", 6-1/2".
const RE_TERM = /^[0-9][0-9.'"\-/]*$/;
// A length-first token: its numbers, then a direction, then perhaps degrees.
const RE_NUMBER_THEN_DIR = new RegExp(`^(${LEN}?)${CARD}(?:-?[0-9]+(?:\\.[0-9]+)?)?$`);

interface Move {
  dx: number;
  dy: number;
  sagitta: number;
}

/** `as` is the same wall written so it no longer depends on the wall before it. */
type TokenResult = { move: Move; as?: string } | { close: true } | { error: string };

function parseSagitta(raw: string | undefined): number | string {
  if (raw === undefined) return 0;
  const neg = raw.startsWith("-");
  const v = parseLength(neg ? raw.slice(1) : raw);
  if (v === null) return `bad arc depth "${raw}"`;
  if (v === 0) return "arc depth must not be 0";
  return neg ? -v : v;
}

/**
 * `heading` is the direction of the wall before this one, in degrees
 * counter-clockwise from "right" (null for the first wall).
 */
function parseToken(tok: string, heading: number | null = null): TokenResult {
  const t = tok.toUpperCase();
  if (t === "CL" || t === "CLOSE" || t === "A") return { close: true };

  if (/^[0-9]/.test(t)) {
    // 10'6R45: turn right 45° from the wall just drawn and go 10'6" (L turns left).
    // With no wall before it, or with U or D, the angle is measured clockwise from that direction.
    const tn = RE_TURN.exec(t);
    if (tn) {
      const d = tn[2]!;
      const u = UNIT[d]!;
      const turn = Number(tn[3]);
      const relative = heading !== null && (d === "R" || d === "L");
      const from = relative ? heading : (Math.atan2(u.y, u.x) * 180) / Math.PI;
      const deg = relative && d === "L" ? from + turn : from - turn;
      const norm = Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6;
      const as = `A${norm}:${tn[1]}${tn[4] ?? ""}`;
      const r = parseToken(as);
      return "move" in r ? { move: r.move, as } : r;
    }
    // Turn "24R" into "R24" and read it as usual. The length stops at the direction letter.
    const lf = RE_LENGTH_FIRST.exec(t);
    if (!lf) return { error: `unknown move "${tok}"` };
    const r = parseToken(`${lf[2]}${lf[1]}${lf[4] ? `${lf[4]}${lf[3]}` : ""}${lf[5] ?? ""}`);
    return "error" in r && r.error.startsWith("unknown move") ? { error: `unknown move "${tok}"` } : r;
  }

  const td = RE_TURN_DIR_FIRST.exec(t);
  if (td) return parseToken(`${td[3]}${td[1]}${td[2]}${td[4] ?? ""}`, heading);

  let m = RE_DIAG.exec(t);
  if (m) {
    const len = parseLength(m[2]!);
    if (len === null) return { error: `bad length "${m[2]}"` };
    const u = DIAG[m[1]!]!;
    const s = parseSagitta(m[3]);
    if (typeof s === "string") return { error: s };
    return { move: { dx: (u.x * len) / Math.SQRT2, dy: (u.y * len) / Math.SQRT2, sagitta: s } };
  }

  m = RE_CARD.exec(t);
  if (m) {
    const len1 = parseLength(m[2]!);
    if (len1 === null) return { error: `bad length "${m[2]}"` };
    const u1 = UNIT[m[1]!]!;
    let dx = u1.x * len1;
    let dy = u1.y * len1;
    if (m[3] !== undefined) {
      const len2 = parseLength(m[4]!);
      if (len2 === null) return { error: `bad length "${m[4]}"` };
      const u2 = UNIT[m[3]]!;
      if (u1.x * u2.x + u1.y * u2.y !== 0) {
        return { error: `${m[1]} and ${m[3]} are not perpendicular` };
      }
      dx += u2.x * len2;
      dy += u2.y * len2;
    }
    const s = parseSagitta(m[5]);
    if (typeof s === "string") return { error: s };
    return { move: { dx, dy, sagitta: s } };
  }

  m = RE_POLAR.exec(t);
  if (m) {
    const deg = Number(m[1]);
    const len = parseLength(m[2]!);
    if (len === null) return { error: `bad length "${m[2]}"` };
    const rad = (deg * Math.PI) / 180;
    const s = parseSagitta(m[3]);
    if (typeof s === "string") return { error: s };
    // Snap tiny float residue (cos 90° etc.) to zero.
    const snap = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
    return { move: { dx: snap(len * Math.cos(rad)), dy: snap(len * Math.sin(rad)), sagitta: s } };
  }

  return { error: `unknown move "${tok}"` };
}

/**
 * Curly quotes and prime marks as plain ' and ". Tablet and phone keyboards
 * (and text pasted from documents) turn 24'6" into 24’6”. One character for
 * one, so positions in the text stay the same.
 */
export function straightQuotes(text: string): string {
  return text.replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"');
}

/** Parse vector text into a path starting at `start`. Never throws; bad tokens are skipped and reported. */
export function parseVectors(text: string, start: Point = { x: 0, y: 0 }): ParseResult {
  const errors: VectorError[] = [];
  const segments: Segment[] = [];
  const sources: (string | null)[] = [];
  let at = { ...start };
  let index = 0;
  let closed = false;
  /**
   * The wall just made, when it is a plain R/L/U/D wall that what is typed next may
   * finish: inches while the length has no foot or inch mark, a + or - and another
   * length, then degrees. `len` is the length so far, as text ("10'6+-3").
   */
  type Turnable = {
    dir: string;
    len: string;
    lengthFirst: boolean;
    heading: number | null;
    index: number;
    /** A + or - was typed and its length has not come yet. */
    op?: { tok: string; offset: number; index: number };
  };
  let turnable: Turnable | null = null;

  // Blank out "# comments" to end of line, keeping character offsets.
  const clean = straightQuotes(text).replace(/#[^\n]*/g, (c) => " ".repeat(c.length));

  // Length first, the numbers come before the direction, so gather them back from it:
  // "10 6R" is 10'6" right, "10 6 - 3 6R" is 7' right. A number followed by inches and
  // a direction therefore starts that wall; it is not inches or degrees for the wall before.
  const toks: { tok: string; offset: number }[] = [];
  for (const match of clean.matchAll(/[^\s,]+/g)) {
    let tok = match[0];
    let offset = match.index ?? 0;
    const lf = RE_NUMBER_THEN_DIR.exec(tok.toUpperCase());
    if (lf) {
      const rest = tok.slice(lf[1]!.length);
      let expr = tok.slice(0, lf[1]!.length);
      const prev = (back: number) => toks[toks.length - back]?.tok ?? "";
      const take = (count: number) => {
        offset = toks[toks.length - count]!.offset;
        toks.length -= count;
      };
      if (RE_INCHES.test(expr) && !/'/.test(expr) && RE_WHOLE.test(prev(1))) {
        expr = `${prev(1)}'${expr}`;
        take(1);
      }
      while (RE_OPERATOR.test(prev(1)) && RE_TERM.test(prev(2))) {
        const op = prev(1) === "+" ? "+" : "+-";
        if (RE_INCHES.test(prev(2)) && !/'/.test(prev(2)) && RE_WHOLE.test(prev(3))) {
          expr = `${prev(3)}'${prev(2)}${op}${expr}`;
          take(3);
        } else {
          expr = `${prev(2)}${op}${expr}`;
          take(2);
        }
      }
      tok = expr + rest;
    }
    toks.push({ tok, offset });
  }

  for (const { tok, offset } of toks) {
    const i = index++;
    if (closed) {
      errors.push({ token: i, offset, text: tok, message: "move after CL" });
      continue;
    }
    // What follows a square wall may finish it. A space stands for the foot mark, so the
    // first number is inches ("R10 6" is 10'6"). A + or - on its own adds or takes off the
    // next length ("R10 6 - 3 6" is 7'). Once the length is complete, a number is degrees
    // ("R10 6 45", "R10'6 45", "R10' 45"): a turn, as in "10'6R45".
    if (turnable && turnable.index === i - 1) {
      const t: Turnable = turnable;
      const seg = segments[segments.length - 1]!;
      const term = t.len.split(/\+-|[+−]/).pop() ?? "";
      const marked = /['"]/.test(term);
      turnable = null;
      const redo = (wall: string, heading: number | null): TokenResult => {
        const made = parseToken(wall, heading);
        if ("move" in made) {
          const to = { x: seg.from.x + made.move.dx, y: seg.from.y + made.move.dy };
          segments[segments.length - 1] = { kind: "line", from: seg.from, to };
          at = to;
        }
        return made;
      };
      const relength = (len: string, bad: string): void => {
        const made = redo(`${len}${t.dir}`, null);
        if ("move" in made) {
          sources[sources.length - 1] = t.lengthFirst ? `${len}${t.dir}` : `${t.dir}${len}`;
          turnable = { dir: t.dir, len, lengthFirst: t.lengthFirst, heading: t.heading, index: i };
        } else {
          errors.push({ token: i, offset, text: tok, message: bad });
        }
      };
      if (t.op) {
        if (RE_TERM.test(tok)) {
          relength(`${t.len}${tok}`, `"${tok}": cannot ${t.op.tok === "+" ? "add" : "take off"} that length`);
          continue;
        }
        errors.push({ token: t.op.index, offset: t.op.offset, text: t.op.tok, message: `"${t.op.tok}": no length after it` });
      } else if (RE_OPERATOR.test(tok)) {
        turnable = { ...t, len: `${t.len}${tok === "+" ? "+" : "+-"}`, index: i, op: { tok, offset, index: i } };
        continue;
      } else if (marked && RE_DEGREES.test(tok)) {
        const made = redo(`${t.len}${t.dir}${tok}`, t.heading);
        if ("move" in made) sources[sources.length - 1] = made.as ?? null;
        else errors.push({ token: i, offset, text: tok, message: `unknown move "${tok}"` });
        continue;
      } else if (!marked && RE_WHOLE.test(term) && RE_INCHES.test(tok)) {
        const hint = RE_DEGREES.test(tok) ? ` (for degrees, end the length with a foot mark: ${t.dir}${t.len}' ${tok})` : "";
        relength(`${t.len}'${tok}`, `"${tok}": inches must be under 12${hint}`);
        continue;
      } else if (!marked && RE_DEGREES.test(tok)) {
        errors.push({ token: i, offset, text: tok, message: `"${tok}": end the length with a foot mark before degrees (${t.dir}${t.len}' ${tok})` });
        continue;
      }
    }
    const last = segments[segments.length - 1];
    const heading = last ? (Math.atan2(last.to.y - last.from.y, last.to.x - last.from.x) * 180) / Math.PI : null;
    const r = parseToken(tok, heading);
    if ("error" in r) {
      errors.push({ token: i, offset, text: tok, message: r.error });
      continue;
    }
    if ("close" in r) {
      closed = true;
      const gap = Math.hypot(start.x - at.x, start.y - at.y);
      if (gap > CLOSE_TOLERANCE_FT) {
        segments.push({ kind: "line", from: at, to: { ...start } });
        sources.push(null);
      } else if (last && gap > 0) {
        last.to = { ...start }; // snap a near-miss onto the start point
      }
      at = { ...start };
      continue;
    }
    const { dx, dy, sagitta } = r.move;
    if (dx === 0 && dy === 0) {
      errors.push({ token: i, offset, text: tok, message: "zero-length wall" });
      continue;
    }
    const to = { x: at.x + dx, y: at.y + dy };
    segments.push(sagitta === 0 ? { kind: "line", from: at, to } : { kind: "arc", from: at, to, sagitta });
    // A turn is recorded as the absolute wall it made, so walls rewritten after a
    // mouse edit or a reorder do not swing round with the wall before them.
    sources.push(r.as ?? tok);
    at = to;
    const square = RE_SQUARE_DIR_FIRST.exec(tok.toUpperCase()) ?? null;
    const squareLf = square ? null : RE_SQUARE_LENGTH_FIRST.exec(tok.toUpperCase());
    turnable = square
      ? { dir: square[1]!, len: square[2]!, lengthFirst: false, heading, index: i }
      : squareLf
        ? { dir: squareLf[2]!, len: squareLf[1]!, lengthFirst: true, heading, index: i }
        : null;
  }

  const dangling = (turnable as Turnable | null)?.op;
  if (dangling) errors.push({ token: dangling.index, offset: dangling.offset, text: dangling.tok, message: `"${dangling.tok}": no length after it` });

  return { path: { start: { ...start }, segments }, errors, sources };
}
