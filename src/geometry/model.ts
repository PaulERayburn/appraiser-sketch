/**
 * Sketch data model and the computation that turns typed vectors into
 * areas and report totals. The vector text is the source of truth; nothing
 * computed here is stored in the file.
 */

import {
  FINISHED_BUCKETS,
  classify,
  roundTotals,
  totalByBucket,
  type AnsiResult,
  type AreaKind,
  type BucketTotals,
  type CeilingBand,
  type Grade,
  type Override,
} from "./ansi.js";
import {
  area as pathArea,
  closure,
  flatten,
  perimeter,
  selfIntersects,
  type Closure,
  type Path,
  type Point,
} from "./path.js";
import { stairDrawing, type Stair } from "./stairs.js";
import type { Door } from "./doors.js";
import { formatLength } from "./units.js";
import { slopeBands, type Slope, type SlopeBand, type ZoneKind } from "./zones.js";
import { parseVectors, type VectorError } from "./vectors.js";

export const FORMAT_VERSION = 1;

export interface Zone {
  id: string;
  name?: string;
  /** A ceiling band, an opening to below, or "sloped" (then `slope` says how). */
  band: ZoneKind;
  origin: Point;
  vectors: string;
  /** Sloped ceiling over the zone; its points are relative to `origin`. Set when band is "sloped". */
  slope?: Slope;
}

/**
 * An interior wall: an open run of walls typed from a start point, like an
 * outline that need not close ("U12 R8"; CL closes it into a closet). Drawn
 * on the floor plan only; it never changes the area.
 */
export interface InteriorWall {
  id: string;
  origin: Point;
  vectors: string;
}

export interface Area {
  id: string;
  name: string;
  kind: AreaKind;
  grade: Grade;
  finished: boolean;
  /** Free label: "1", "2", "attic", "basement" … */
  level: string;
  connected: boolean;
  ceiling: CeilingBand;
  origin: Point;
  vectors: string;
  zones: Zone[];
  /** Stair symbols drawn on this level. They never change the area (ANSI: they count on the floor above). */
  stairs?: Stair[];
  /** Interior walls (floor plan only; never change the area). */
  walls?: InteriorWall[];
  /** Doors set in the outline or the interior walls (floor plan only; never change the area). */
  doors?: Door[];
  override?: Override;
  /** Area label offset from the outline's centre, feet. */
  label?: Point;
  /** Hide this area's name/size label. */
  hideLabel?: boolean;
  /** Hide this area's wall dimensions. */
  hideDims?: boolean;
  /** Walls (by number, from 0) whose dimension is hidden. */
  hiddenDims?: number[];
}

export type StructureKind = "dwelling" | "adu" | "garage" | "barn" | "shed" | "outbuilding";

export const STRUCTURE_KINDS: { value: StructureKind; label: string }[] = [
  { value: "dwelling", label: "Dwelling" },
  { value: "adu", label: "ADU" },
  { value: "garage", label: "Detached garage" },
  { value: "barn", label: "Barn" },
  { value: "shed", label: "Shed" },
  { value: "outbuilding", label: "Outbuilding" },
];

export function structureKindLabel(kind: StructureKind): string {
  return STRUCTURE_KINDS.find((k) => k.value === kind)?.label ?? "Structure";
}

/** Whether a structure name is still an automatic one ("Dwelling", "Barn 2", or the old defaults), not typed by the user. */
export function isDefaultStructureName(name: string): boolean {
  const base = name.trim().replace(/\s+\d+$/, "");
  return base === "" || base === "Main house" || base === "Structure" || STRUCTURE_KINDS.some((k) => k.label === base);
}

/** A name from the type, numbered if another structure already has it: "Barn", "Barn 2". */
export function defaultStructureName(kind: StructureKind, others: string[]): string {
  const base = structureKindLabel(kind);
  if (!others.includes(base)) return base;
  let i = 2;
  while (others.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export interface Structure {
  id: string;
  name: string;
  kind: StructureKind;
  areas: Area[];
}

export interface SketchMeta {
  subject?: string;
  client?: string;
  borrower?: string;
  fileNumber?: string;
  appraiser?: string;
  date?: string;
  /** ANSI Z765 rules on (default) or off for private work. */
  ansi: boolean;
  /** Show wall dimensions (default true). Applies to screen and print. */
  showDims?: boolean;
  /** Show area name/size labels (default true). */
  showLabels?: boolean;
}

/** A free text label on the drawing (room names: "Bedroom", "Kitchen"…). */
export interface TextLabel {
  id: string;
  text: string;
  /** World position of the text's centre, feet. */
  at: Point;
}

/** Names offered as one-click labels, in groups. */
export const LABEL_GROUPS: { name: string; labels: string[] }[] = [
  {
    name: "Rooms",
    labels: [
      "Bedroom", "Primary Bedroom", "Full Bath", "3/4 Bath", "Half Bath", "Kitchen", "Living Room",
      "Dining Room", "Family Room", "Den", "Office", "Laundry", "Mudroom", "Foyer", "Hall", "Closet",
      "Walk-in Closet", "Pantry", "Utility", "Mechanical", "Storage", "Bonus Room", "Sunroom", "Rec Room",
    ],
  },
  {
    name: "Garages & outbuildings",
    labels: [
      "1-Car Garage", "2-Car Garage", "3-Car Garage", "Attached Garage", "Detached Garage", "Built-in Garage",
      "Tandem Garage", "Carport", "1-Car Carport", "2-Car Carport", "Barn", "Pole Barn", "Horse Barn",
      "Shed", "Storage Shed", "Workshop", "Lean-to", "Loft",
    ],
  },
  {
    name: "Decks, porches & patios",
    labels: [
      "Deck", "Covered Deck", "Open Porch", "Covered Porch", "Enclosed Porch", "Screened Porch",
      "Three-Season Porch", "Farmer's Porch", "Patio", "Covered Patio", "Breezeway", "Balcony", "Stoop",
    ],
  },
];

/** Every built-in label, flat. */
export const COMMON_LABELS = LABEL_GROUPS.flatMap((g) => g.labels);

export interface Sketch {
  formatVersion: number;
  meta: SketchMeta;
  structures: Structure[];
  /** Room and other free labels, drawn on top. */
  texts?: TextLabel[];
}

export interface ShapeResult {
  path: Path;
  errors: VectorError[];
  area: number;
  perimeter: number;
  closure: Closure;
  selfIntersects: boolean;
}

export function computeShape(vectors: string, origin: Point): ShapeResult {
  const { path, errors } = parseVectors(vectors, origin);
  return {
    path,
    errors,
    area: pathArea(path),
    perimeter: perimeter(path),
    closure: closure(path),
    selfIntersects: selfIntersects(path),
  };
}

export interface ZoneResult extends ShapeResult {
  zone: Zone;
  /** False if some of the zone lies outside its area's outline. */
  inside: boolean;
  /** For a sloped zone: its under-5', 5'–7' and 7'+ parts. */
  bands?: SlopeBand[];
}

export interface WallResult {
  wall: InteriorWall;
  path: Path;
  errors: VectorError[];
  /** False if some of the wall lies outside its area's outline. */
  inside: boolean;
}

export interface AreaResult {
  area: Area;
  shape: ShapeResult;
  zones: ZoneResult[];
  walls: WallResult[];
  ansi: AnsiResult;
  /** Every problem with this area, for display: vector errors, closure, ANSI warnings. */
  problems: string[];
}

/** The move that would close an outline, e.g. "D1'2\"" or "R3' U1'". */
export function closingMove(dx: number, dy: number): string {
  const parts: string[] = [];
  const tol = 1 / 24; // under half an inch rounds to nothing
  if (Math.abs(dx) >= tol) parts.push(`${dx > 0 ? "R" : "L"}${formatLength(Math.abs(dx))}`);
  if (Math.abs(dy) >= tol) parts.push(`${dy > 0 ? "U" : "D"}${formatLength(Math.abs(dy))}`);
  return parts.join(" ") || "under 1/2\"";
}

const EDGE_TOL = 1e-6;

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= EDGE_TOL;
  if (Math.abs(cross) / len > EDGE_TOL) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= -EDGE_TOL && dot <= len * len + EDGE_TOL;
}

/** Point strictly inside a polygon (not on its boundary). */
function strictlyInside(poly: Point[], p: Point): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (onSegment(p, poly[i]!, poly[j]!)) return false;
  return containsPoint(poly, p);
}

/**
 * Whether two zone outlines overlap (share more than an edge). Checks each
 * outline's corners, edge midpoints and centre against the other, which
 * catches the overlaps zones produce in practice (strips, rectangles).
 */
export function outlinesOverlap(a: Point[], b: Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const probes = (poly: Point[]) => {
    const pts = [...poly];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      pts.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    }
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    pts.push({ x: cx, y: cy });
    return pts;
  };
  return probes(a).some((p) => strictlyInside(b, p)) || probes(b).some((p) => strictlyInside(a, p));
}

/** Point inside a polygon or on its boundary. */
export function containsPoint(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function computeArea(area: Area, opts: { ansi?: boolean } = {}): AreaResult {
  const shape = computeShape(area.vectors, area.origin);
  const outline = flatten(shape.path);
  const problems: string[] = [];

  for (const e of shape.errors) problems.push(`"${e.text}": ${e.message}`);
  if (!shape.closure.closed && shape.path.segments.length > 0) {
    problems.push(
      `outline does not close: misses the start by ${formatLength(shape.closure.distance)} ` +
        `(${closingMove(shape.closure.dx, shape.closure.dy)} to close); area assumes a straight closing wall`,
    );
  }
  if (shape.selfIntersects) problems.push("outline crosses itself; area is not reliable");

  const zones: ZoneResult[] = area.zones.map((zone, zi) => {
    const s = computeShape(zone.vectors, zone.origin);
    const inside = flatten(s.path).every((p) => containsPoint(outline, p));
    // Unnamed zones go by their number in the list, as the zones panel shows them.
    const label = zone.name ?? `${zi + 1}`;
    for (const e of s.errors) problems.push(`zone ${label}: "${e.text}": ${e.message}`);
    if (!s.closure.closed && s.path.segments.length > 0) problems.push(`zone ${label}: outline does not close`);
    if (!inside) problems.push(`zone ${label}: extends outside the area`);
    if (zone.band === "sloped") {
      if (!zone.slope) {
        problems.push(`zone ${label}: sloped ceiling has no heights; counted at the area's ceiling`);
        return { ...s, zone, inside };
      }
      return { ...s, zone, inside, bands: slopeBands(flatten(s.path), zone.origin, zone.slope, s.area) };
    }
    return { ...s, zone, inside };
  });

  const zoneOutlines = zones.map((z) => flatten(z.path));
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (outlinesOverlap(zoneOutlines[i]!, zoneOutlines[j]!)) {
        const li = zones[i]!.zone.name ?? `${i + 1}`;
        const lj = zones[j]!.zone.name ?? `${j + 1}`;
        problems.push(`zones ${li} and ${lj} overlap; the overlap is counted twice, so adjust one of them`);
      }
    }
  }

  (area.stairs ?? []).forEach((st, i) => {
    if (outline.length < 3) return;
    const pts = stairDrawing(st).parts.flat();
    if (!pts.every((p) => containsPoint(outline, p))) problems.push(`stair ${i + 1}: drawn outside the area`);
  });

  const walls: WallResult[] = (area.walls ?? []).map((wall, i) => {
    const { path, errors } = parseVectors(wall.vectors, wall.origin);
    const pts = path.segments.length ? flatten(path) : [];
    const inside = outline.length < 3 || pts.every((p) => containsPoint(outline, p));
    for (const e of errors) problems.push(`interior wall ${i + 1}: "${e.text}": ${e.message}`);
    if (!inside) problems.push(`interior wall ${i + 1}: extends outside the area`);
    return { wall, path, errors, inside };
  });

  const ansi = classify(
    {
      kind: area.kind,
      grade: area.grade,
      finished: area.finished,
      connected: area.connected,
      ceiling: area.ceiling,
      grossArea: shape.area,
      zones: zones.flatMap((z): { band: CeilingBand | "opening"; area: number }[] =>
        z.zone.band !== "sloped"
          ? [{ band: z.zone.band, area: z.area }]
          : z.bands
            ? z.bands.map((b) => ({ band: b.band, area: b.area }))
            : [{ band: area.ceiling, area: z.area }],
      ),
      override: area.override,
    },
    opts,
  );
  problems.push(...ansi.warnings);

  return { area, shape, zones, walls, ansi, problems };
}

/** Finished/unfinished living area on one level (UAD 3.6 LEVEL). Unrounded. */
export interface LevelTotal {
  level: string;
  grade: Grade;
  finished: number;
  unfinished: number;
}

export interface StructureResult {
  structure: Structure;
  areas: AreaResult[];
  levels: LevelTotal[];
  /** Unrounded bucket totals. */
  exact: BucketTotals;
  /** Whole-square-foot totals for the report. */
  reported: BucketTotals;
  overrides: { area: string; note: string }[];
}

export function computeStructure(structure: Structure, opts: { ansi?: boolean } = {}): StructureResult {
  const areas = structure.areas.map((a) => computeArea(a, opts));
  const exact = totalByBucket(areas.map((a) => a.ansi));
  const levels = new Map<string, LevelTotal>();
  for (const a of areas) {
    if (a.area.kind !== "living" || a.ansi.bucket === "excluded") continue;
    const key = `${a.area.grade}:${a.area.level}`;
    const t = levels.get(key) ?? { level: a.area.level, grade: a.area.grade, finished: 0, unfinished: 0 };
    if (FINISHED_BUCKETS.has(a.ansi.bucket)) t.finished += a.ansi.counted;
    else t.unfinished += a.ansi.counted;
    levels.set(key, t);
  }
  return {
    structure,
    areas,
    levels: [...levels.values()],
    exact,
    reported: roundTotals(exact),
    overrides: areas
      .filter((a) => a.ansi.nonAnsi)
      .map((a) => ({ area: a.area.name, note: a.area.override?.note ?? "" })),
  };
}

export interface SketchResult {
  sketch: Sketch;
  structures: StructureResult[];
  /** True if ANSI rules are off or any area is overridden. */
  nonAnsi: boolean;
}

export function computeSketch(sketch: Sketch): SketchResult {
  const opts = { ansi: sketch.meta.ansi };
  const structures = sketch.structures.map((s) => computeStructure(s, opts));
  return {
    sketch,
    structures,
    nonAnsi: !sketch.meta.ansi || structures.some((s) => s.overrides.length > 0),
  };
}
