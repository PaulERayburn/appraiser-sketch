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
  /** The token that made each segment (same order as path.segments); null for a wall added by CL. */
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

const LEN = String.raw`[0-9][0-9.'"\-/]*`;
const CARD = "[RLUDNSEW]";
const DIAGS = "UR|UL|DR|DL|NE|NW|SE|SW";
const ARC = String.raw`(?:\^(-?${LEN}))?`;

const RE_DIAG = new RegExp(`^(${DIAGS})(${LEN})${ARC}$`);
const RE_CARD = new RegExp(`^(${CARD})(${LEN})(?:(${CARD})(${LEN}))?${ARC}$`);
const RE_POLAR = new RegExp(String.raw`^A(-?[0-9]+(?:\.[0-9]+)?):(${LEN})${ARC}$`);

// Length first, as many appraisers write it in the field: 24R, 24'6"U, 10R5U, 10UR, 20R^3.
const RE_LENGTH_FIRST = new RegExp(`^(${LEN}?)(${DIAGS}|${CARD})(?:(${LEN}?)(${CARD}))?(\\^-?${LEN})?$`);

interface Move {
  dx: number;
  dy: number;
  sagitta: number;
}

type TokenResult = { move: Move } | { close: true } | { error: string };

function parseSagitta(raw: string | undefined): number | string {
  if (raw === undefined) return 0;
  const neg = raw.startsWith("-");
  const v = parseLength(neg ? raw.slice(1) : raw);
  if (v === null) return `bad arc depth "${raw}"`;
  if (v === 0) return "arc depth must not be 0";
  return neg ? -v : v;
}

function parseToken(tok: string): TokenResult {
  const t = tok.toUpperCase();
  if (t === "CL" || t === "CLOSE" || t === "A") return { close: true };

  if (/^[0-9]/.test(t)) {
    // Turn "24R" into "R24" and read it as usual. The length stops at the direction letter.
    const lf = RE_LENGTH_FIRST.exec(t);
    if (!lf) return { error: `unknown move "${tok}"` };
    const r = parseToken(`${lf[2]}${lf[1]}${lf[4] ? `${lf[4]}${lf[3]}` : ""}${lf[5] ?? ""}`);
    return "error" in r && r.error.startsWith("unknown move") ? { error: `unknown move "${tok}"` } : r;
  }

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

  // Blank out "# comments" to end of line, keeping character offsets.
  const clean = straightQuotes(text).replace(/#[^\n]*/g, (c) => " ".repeat(c.length));

  for (const match of clean.matchAll(/[^\s,]+/g)) {
    const tok = match[0];
    const offset = match.index ?? 0;
    const i = index++;
    if (closed) {
      errors.push({ token: i, offset, text: tok, message: "move after CL" });
      continue;
    }
    const r = parseToken(tok);
    if ("error" in r) {
      errors.push({ token: i, offset, text: tok, message: r.error });
      continue;
    }
    if ("close" in r) {
      closed = true;
      const gap = Math.hypot(start.x - at.x, start.y - at.y);
      const last = segments[segments.length - 1];
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
    sources.push(tok);
    at = to;
  }

  return { path: { start: { ...start }, segments }, errors, sources };
}
