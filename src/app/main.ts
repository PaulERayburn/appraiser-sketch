/// <reference types="vite/client" />
import {
  BUCKETS,
  BUCKET_LABELS,
  bounds,
  closingMove,
  computeSketch,
  flatten,
  formatLength,
  formatSqFt,
  parseLength,
  type AreaKind,
  type Bucket,
  type CeilingBand,
  type Grade,
  type Point,
  type SketchResult,
  type StructureKind,
  STAIR_TYPES,
  defaultStair,
  stairDrawing,
  stairPlan,
  type Stair,
  type StairHandleKey,
  dragStairHandle,
  TEMPLATES,
  checkTemplate,
  ZONE_BANDS,
  LABEL_GROUPS,
  COMMON_LABELS,
  stripZone,
  slopeStrip,
  setSlopeRun,
  slopeFromSide,
  slopeSide,
  depthFrom,
  type ZoneKind,
  zoneLabel,
  zoneShort,
  applyArrow,
  corners,
  skipToCorner,
  closeOutline,
  deleteWall,
  moveCorners,
  remapHiddenDims,
  adjustLastWall,
  smallStep,
  lengthStyle,
  setLengthStyle,
  type LengthStyle,
  corners as areaCorners,
  parseVectors,
  straightQuotes,
  type AreaResult,
  type Area,
  type Structure,
  containsPoint,
  copyArea,
  defaultStructureName,
  isDefaultStructureName,
  copyStairTo,
  stairHome,
  type Side,
  type ZoneBand,
  moveToken,
  snapWallPoint,
  type SnapTargets,
} from "../geometry/index.js";
import { levelName, totalGroups, totalsText } from "../export/text.js";
import { printPageHtml, sketchPng } from "../export/print.js";
import { reportExportJson } from "../export/report.js";
import { FileManager, SketchFileError, download, draftWasRejected, loadDraft, saveDraft } from "./files.js";
import { exportLabels, mergeLabels, parseLabelsFile } from "./labels.js";
import { centroid, renderSketch, toWorld, type View } from "./render.js";
import { Store, findArea, newArea, newId, newSketch, newStructure, typingStep, type Selection } from "./store.js";

// Length style (feet-inches or decimal feet), a per-viewer preference; set before anything is drawn.
const UNITS_KEY = "sketch:units";
try {
  const u = localStorage.getItem(UNITS_KEY);
  if (u === "decimal" || u === "ftin") setLengthStyle(u);
} catch {
  /* storage unavailable */
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const store = new Store(loadDraft() ?? newSketch());
const files = new FileManager();
let result: SketchResult = computeSketch(store.state.sketch);
let view: View = { scale: 12, ox: 80, oy: 400 };
let savedRevision = store.revision;
/** True while applying undo/redo/open, so focused inputs are refreshed too. */
let external = true;

// ---------- canvas ----------

const canvas = $<HTMLDivElement>("canvas");

function measure() {
  const r = canvas.getBoundingClientRect();
  return { width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) };
}
/**
 * The drawing's size in pixels. Kept from the last resize rather than measured
 * on every redraw: measuring straight after the page has been rewritten makes
 * the browser lay the whole page out again, which was over half of each redraw.
 */
let canvasSize: { width: number; height: number } | null = null;
function size() {
  return (canvasSize ??= measure());
}

/** Corner of the selected area picked for Open here (UI state, not saved). */
let activeCorner: { area: string; index: number } | null = null;

let showGrid = true;
let showAngles = true;
try {
  showAngles = localStorage.getItem("sketch:angles") !== "off";
} catch {
  /* storage unavailable */
}
try {
  showGrid = localStorage.getItem("sketch:grid") !== "off";
} catch {
  /* storage unavailable */
}

function drawCanvas() {
  const { width, height } = size();
  const sel = store.state.selection;
  const corner = activeCorner && sel?.area === activeCorner.area && !sel.stair && !sel.zone && !sel.iwall ? activeCorner.index : null;
  const preview = drawing ? hover : null;
  canvas.innerHTML = renderSketch(result, { width, height, view, selection: sel, grid: showGrid, activeCorner: corner, selectedText, angles: showAngles, picked, preview });
}

function sketchBounds() {
  let b: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.shape.path.segments.length === 0) continue;
      const ab = bounds(a.shape.path);
      b = b
        ? { minX: Math.min(b.minX, ab.minX), minY: Math.min(b.minY, ab.minY), maxX: Math.max(b.maxX, ab.maxX), maxY: Math.max(b.maxY, ab.maxY) }
        : ab;
    }
  }
  // Only stretch for labels when there is a drawing, so a lone label doesn't zoom in on itself.
  if (b) {
    for (const t of store.state.sketch.texts ?? []) {
      b = { minX: Math.min(b.minX, t.at.x), minY: Math.min(b.minY, t.at.y), maxX: Math.max(b.maxX, t.at.x), maxY: Math.max(b.maxY, t.at.y) };
    }
  }
  return b;
}

let autoFit = true;
try {
  autoFit = localStorage.getItem("sketch:autofit") !== "off";
} catch {
  /* storage unavailable */
}
const autoFitToggle = document.getElementById("auto-fit") as HTMLInputElement;
autoFitToggle.checked = autoFit;

function setAutoFit(on: boolean) {
  if (autoFit === on) return;
  autoFit = on;
  autoFitToggle.checked = on;
  try {
    localStorage.setItem("sketch:autofit", on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
}

/** Zoomed or panned by hand: stop auto fitting so the view stays put. */
function manualView() {
  if (!autoFit) return;
  setAutoFit(false);
  say("Auto fit off — F or Fit to fit again");
}

/** Zoom Fit would use on this screen (px per foot): print text is sized against it, not the current zoom. */
function fittedScale(): number {
  const b = sketchBounds();
  const { width, height } = size();
  if (!b) return 12;
  const pad = 60;
  return Math.min((width - 2 * pad) / Math.max(b.maxX - b.minX, 10), (height - 2 * pad) / Math.max(b.maxY - b.minY, 10), 40);
}

function fit() {
  const b = sketchBounds();
  const { width, height } = size();
  if (!b) {
    view = { scale: 12, ox: width / 2, oy: height / 2 };
  } else {
    const pad = 60;
    const w = Math.max(b.maxX - b.minX, 10);
    const h = Math.max(b.maxY - b.minY, 10);
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, 40);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    view = { scale, ox: width / 2 - cx * scale, oy: height / 2 + cy * scale };
  }
  drawCanvas();
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const w = toWorld(view, p);
    const scale = Math.min(200, Math.max(1, view.scale * Math.exp(-e.deltaY * 0.0015)));
    view = { scale, ox: p.x - w.x * scale, oy: p.y + w.y * scale };
    manualView();
    drawCanvas();
  },
  { passive: false },
);

type Drag =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      ox: number;
      oy: number;
      at: Point;
      moved: boolean;
      /** Drawing interior walls: a click (not a drag) places a point here (screen px); Alt held places it freely. */
      place?: { px: Point; free: boolean };
    }
  | { kind: "move"; sel: Selection; start: Point; origin: Point; key: string; carry?: string[] }
  | { kind: "handle"; sel: Selection; handle: StairHandleKey; key: string }
  | { kind: "label"; sel: Selection; start: Point; offset: Point; key: string; moved?: boolean }
  | { kind: "text"; id: string; start: Point; at: Point; key: string }
  | { kind: "iwall-corner"; sel: Selection; corner: number; base: Point; neighbours: Point[]; vectors: string; origin: Point; start: Point; key: string }
  | {
      kind: "corner";
      sel: Selection;
      /** Corners being moved (one corner, or both ends of a wall). */
      corners: number[];
      /** Corner positions at drag start, by index. */
      base: Point[];
      vectors: string;
      /** Hidden dimensions at drag start (wall numbers of `vectors`). */
      hidden: number[] | undefined;
      origin: Point;
      start: Point;
      startPx: Point;
      /** Unit normal when sliding a wall; null for a free corner. */
      normal: Point | null;
      moved: boolean;
      key: string;
    };

let drag: Drag | null = null;
let dragSeq = 0;
/**
 * Grid snapping for mouse moves: the length unit (1" or 0.1'), 6"/half a
 * foot, a whole foot, or off (corners still snap). A per-viewer setting.
 */
type SnapMode = "unit" | "half" | "foot" | "off";
const SNAP_KEY = "sketch:snap";
let snapMode: SnapMode = "unit";
try {
  const v = localStorage.getItem(SNAP_KEY);
  if (v === "unit" || v === "half" || v === "foot" || v === "off") snapMode = v;
} catch {
  /* storage unavailable */
}
function snapStep(): number {
  return snapMode === "unit" ? smallStep() : snapMode === "half" ? 0.5 : snapMode === "foot" ? 1 : 0;
}
/** Round a length in feet to the snap grid (no rounding when snapping is off). */
function snap(v: number): number {
  const step = snapStep();
  return step > 0 ? Math.round(Math.round(v / step) * step * 1e6) / 1e6 : v;
}
const VERTEX_SNAP_PX = 10;
/** Interior walls reach a little further to find a wall or corner: running a wall to a wall is the usual case. */
const WALL_SNAP_PX = 16;

/** Corners of every area outline, optionally leaving one area out. */
function areaVertices(skipArea?: string): Point[] {
  const pts: Point[] = [];
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.area.id === skipArea) continue;
      pts.push(...flatten(a.shape.path, Math.PI / 8));
    }
  }
  return pts;
}

/**
 * Snap a move of `mine` (points at the original position) by the proposed
 * offset: onto a target corner if one is within a few pixels, otherwise to
 * the half-foot grid. Returns the new origin.
 */
function snapMove(mine: Point[], targets: Point[], origin: Point, proposed: Point, free: boolean): Point {
  if (free) return proposed;
  const dx = proposed.x - origin.x;
  const dy = proposed.y - origin.y;
  let best: { d: number; ox: number; oy: number } | null = null;
  for (const m of mine) {
    const mx = m.x + dx;
    const my = m.y + dy;
    for (const o of targets) {
      const d = Math.hypot(o.x - mx, o.y - my) * view.scale;
      if (d < VERTEX_SNAP_PX && (!best || d < best.d)) best = { d, ox: o.x - mx, oy: o.y - my };
    }
  }
  if (best) return { x: proposed.x + best.ox, y: proposed.y + best.oy };
  return { x: snap(proposed.x), y: snap(proposed.y) };
}

function dragOrigin(sel: Selection): Point | null {
  const f = findArea(store.state.sketch, sel);
  if (!f) return null;
  if (sel.stair) return (f.area.stairs ?? []).find((st) => st.id === sel.stair)?.origin ?? null;
  if (sel.zone) return f.area.zones.find((z) => z.id === sel.zone)?.origin ?? null;
  if (sel.iwall) return (f.area.walls ?? []).find((w) => w.id === sel.iwall)?.origin ?? null;
  return f.area.origin;
}

// ---------- interior walls: drawing with the mouse ----------

/** Drawing interior walls on an area; `wall` is the one being drawn, once its start is placed. */
let drawing: { sel: Selection; wall: string | null } | null = null;
/** Where the next click would land while drawing (shown as a marker and a dashed line). */
let hover: { from: Point | null; to: Point; kind: string } | null = null;

function areaResultFor(areaId: string): AreaResult | undefined {
  return result.structures.flatMap((s) => s.areas).find((a) => a.area.id === areaId);
}

/** Corners and wall lines an interior wall snaps to: every outline and interior wall on the drawing. */
function wallSnapTargets(skipWall?: string): SnapTargets {
  const points: Point[] = [];
  const lines: [Point, Point][] = [];
  const addRun = (pts: Point[], closed: boolean) => {
    points.push(...pts);
    for (let i = 0; i + 1 < pts.length; i++) lines.push([pts[i]!, pts[i + 1]!]);
    if (closed && pts.length > 2) lines.push([pts[pts.length - 1]!, pts[0]!]);
  };
  for (const s of result.structures) {
    for (const a of s.areas) {
      if (a.shape.path.segments.length) addRun(flatten(a.shape.path, Math.PI / 8), true);
      for (const w of a.walls) if (w.wall.id !== skipWall && w.path.segments.length) addRun(flatten(w.path, Math.PI / 8), false);
    }
  }
  return { points, lines };
}

/** The end of the wall being drawn (where the next segment starts), or null before its start is placed. */
function wallPen(): Point | null {
  if (!drawing?.wall) return null;
  const w = areaResultFor(drawing.sel.area)?.walls.find((x) => x.wall.id === drawing!.wall);
  if (!w) return null;
  return w.path.segments.at(-1)?.to ?? w.path.start;
}

function snapForWall(px: Point, free: boolean): { prev: Point | null; at: Point; kind: string } {
  const prev = wallPen();
  const r = snapWallPoint(toWorld(view, px), prev, wallSnapTargets(), { tol: WALL_SNAP_PX / view.scale, step: snapStep(), free });
  return { prev, at: r.at, kind: r.kind };
}

const iwallButton = $<HTMLButtonElement>("btn-add-iwall");

function startDrawingWalls() {
  const sel = store.state.selection;
  if (!sel) return;
  drawing = { sel: { structure: sel.structure, area: sel.area }, wall: null };
  hover = null;
  activeCorner = null;
  canvas.classList.add("drawing-walls");
  iwallButton.textContent = "Done drawing walls";
  iwallButton.classList.add("active");
  store.select({ structure: sel.structure, area: sel.area });
  canvas.focus();
  say("Click where the wall starts");
}

/** Stop drawing interior walls (Enter, Esc, double-click, or the button). Returns false if not drawing. */
function finishDrawingWalls(): boolean {
  if (!drawing) return false;
  const d = drawing;
  drawing = null;
  hover = null;
  canvas.classList.remove("drawing-walls");
  iwallButton.textContent = "+ Interior wall";
  iwallButton.classList.remove("active");
  say("Stopped drawing walls");
  // A wall with only a start point is nothing: drop it.
  const w = d.wall ? (findArea(store.state.sketch, d.sel)?.area.walls ?? []).find((x) => x.id === d.wall) : undefined;
  if (w && parseVectors(w.vectors, w.origin).path.segments.length === 0) {
    store.update((draft) => {
      const f = findArea(draft, d.sel);
      if (!f) return;
      f.area.walls = (f.area.walls ?? []).filter((x) => x.id !== w.id);
      if (f.area.walls.length === 0) delete f.area.walls;
      return { ...d.sel };
    });
  } else {
    drawCanvas();
    drawVectorBar();
  }
  return true;
}

/** A click while drawing: the wall's start point, then one corner per click. Clicking the last point again finishes. */
function placeWallPoint(px: Point, free: boolean) {
  const d = drawing;
  if (!d) return;
  const { prev, at } = snapForWall(px, free);
  if (!prev) {
    const id = newId("w");
    store.update((draft) => {
      const f = findArea(draft, d.sel);
      if (!f) return;
      (f.area.walls ??= []).push({ id, origin: at, vectors: "" });
      return { ...d.sel, iwall: id };
    });
    d.wall = id;
    say("Click each corner of the wall, or type walls (U12 R8). Double-click, Enter or Esc when done.");
    return;
  }
  const tok = moveToken(at.x - prev.x, at.y - prev.y);
  if (tok === "") {
    // Clicked where the wall already ends: finish this wall and start another.
    d.wall = null;
    store.select({ ...d.sel });
    hover = null;
    say("Wall done. Click to start another, or Enter / Esc to stop drawing.");
    return;
  }
  store.update((draft) => {
    const w = (findArea(draft, d.sel)?.area.walls ?? []).find((x) => x.id === d.wall);
    if (w) w.vectors = (w.vectors.trim() ? `${w.vectors.trimEnd()} ` : "") + tok;
  });
}

iwallButton.addEventListener("click", () => {
  if (!finishDrawingWalls()) startDrawingWalls();
});

canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const el = e.target as Element;
  const stairEl = el.closest("[data-stair]");
  const areaEl = el.closest("[data-area]");
  const r = canvas.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
  if (drawing && e.button === 0) {
    // A click places a point; a drag still pans.
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy, at: toWorld(view, p), moved: false, place: { px: p, free: e.altKey } };
    return;
  }
  const iwallCornerEl = el.closest("[data-iwall-corner]");
  if (iwallCornerEl && e.button === 0) {
    const sel: Selection = {
      structure: iwallCornerEl.getAttribute("data-structure")!,
      area: iwallCornerEl.getAttribute("data-area")!,
      iwall: iwallCornerEl.getAttribute("data-iwall")!,
    };
    const w = (findArea(store.state.sketch, sel)?.area.walls ?? []).find((x) => x.id === sel.iwall);
    if (!w) return;
    const corner = Number(iwallCornerEl.getAttribute("data-iwall-corner"));
    const pts = areaCorners(w.vectors, w.origin);
    const base = pts[corner];
    if (!base) return;
    dragSeq += 1;
    drag = {
      kind: "iwall-corner", sel, corner, base, neighbours: [pts[corner - 1], pts[corner + 1]].filter((q): q is Point => !!q),
      vectors: w.vectors, origin: { ...w.origin }, start: toWorld(view, p), key: `iwall-corner:${sel.iwall}:${dragSeq}`,
    };
    return;
  }
  const iwallEl = el.closest("[data-iwall]");
  if (iwallEl && e.button === 0) {
    const sel: Selection = { structure: iwallEl.getAttribute("data-structure")!, area: iwallEl.getAttribute("data-area")!, iwall: iwallEl.getAttribute("data-iwall")! };
    store.select(sel);
    const origin = dragOrigin(sel);
    if (origin) {
      dragSeq += 1;
      drag = { kind: "move", sel, start: toWorld(view, p), origin: { ...origin }, key: `move:${sel.iwall}:${dragSeq}` };
    }
    return;
  }
  const cornerEl = el.closest("[data-corner]");
  const wallEl = cornerEl ? null : el.closest("[data-wall]");
  if ((cornerEl || wallEl) && e.button === 0) {
    const t = (cornerEl ?? wallEl)!;
    const sel: Selection = { structure: t.getAttribute("data-structure")!, area: t.getAttribute("data-area")! };
    const f = findArea(store.state.sketch, sel);
    if (!f) return;
    const base = areaCorners(f.area.vectors, f.area.origin);
    const segs = parseVectors(f.area.vectors, f.area.origin).path.segments;
    // areaCorners drops the repeated start on a closed outline; an open one keeps its pen corner.
    let corners: number[];
    let normal: Point | null = null;
    if (cornerEl) {
      corners = [Number(cornerEl.getAttribute("data-corner"))];
    } else {
      const k = Number(wallEl!.getAttribute("data-wall"));
      const sg = segs[k];
      if (!sg) return;
      corners = [k, (k + 1) % Math.max(base.length, 1)];
      const len = Math.hypot(sg.to.x - sg.from.x, sg.to.y - sg.from.y) || 1;
      normal = { x: -(sg.to.y - sg.from.y) / len, y: (sg.to.x - sg.from.x) / len };
    }
    if (segs.length > 0 && base.length === segs.length + 1) {
      // Open outline: corner indices run 0..n, no wrap.
      if (!cornerEl) corners = [corners[0]!, corners[0]! + 1];
    }
    dragSeq += 1;
    drag = {
      kind: "corner", sel, corners, base, vectors: f.area.vectors, hidden: f.area.hiddenDims, origin: { ...f.area.origin },
      start: toWorld(view, p), startPx: { x: e.clientX, y: e.clientY }, normal, moved: false, key: `corner:${sel.area}:${dragSeq}`,
    };
    return;
  }
  const textEl = el.closest("[data-text]");
  if (textEl && e.button === 0) {
    const id = textEl.getAttribute("data-text")!;
    const t = (store.state.sketch.texts ?? []).find((x) => x.id === id);
    if (!t) return;
    selectText(id);
    dragSeq += 1;
    drag = { kind: "text", id, start: toWorld(view, p), at: { ...t.at }, key: `text:${id}:${dragSeq}` };
    return;
  }
  if (selectedText) selectText(null);
  const dimEl = el.closest("[data-dim]");
  if (dimEl && e.button === 0) {
    const sel: Selection = { structure: dimEl.getAttribute("data-structure")!, area: dimEl.getAttribute("data-area")! };
    store.select(sel);
    pick({ kind: "dim", area: sel.area, wall: Number(dimEl.getAttribute("data-dim")) });
    return;
  }
  if (picked) pick(null);
  const handleEl = el.closest("[data-handle]");
  const labelEl = el.closest("[data-label]");
  if (handleEl && e.button === 0) {
    const sel: Selection = {
      structure: handleEl.getAttribute("data-structure")!,
      area: handleEl.getAttribute("data-area")!,
      stair: handleEl.getAttribute("data-stair")!,
    };
    dragSeq += 1;
    drag = { kind: "handle", sel, handle: handleEl.getAttribute("data-handle") as StairHandleKey, key: `handle:${sel.stair}:${dragSeq}` };
    return;
  }
  if (labelEl && e.button === 0) {
    const sel: Selection = { structure: labelEl.getAttribute("data-structure")!, area: labelEl.getAttribute("data-area")! };
    store.select(sel);
    const f = findArea(store.state.sketch, sel);
    dragSeq += 1;
    drag = { kind: "label", sel, start: toWorld(view, p), offset: { ...(f?.area.label ?? { x: 0, y: 0 }) }, key: `label:${sel.area}:${dragSeq}` };
    return;
  }
  const zoneEl = stairEl ? null : el.closest("[data-zone]");
  if ((stairEl || zoneEl || areaEl) && e.button === 0) {
    const t = (stairEl ?? zoneEl ?? areaEl)!;
    const sel: Selection = { structure: t.getAttribute("data-structure")!, area: t.getAttribute("data-area")! };
    if (stairEl) sel.stair = stairEl.getAttribute("data-stair")!;
    if (zoneEl) sel.zone = zoneEl.getAttribute("data-zone")!;
    store.select(sel);
    const origin = dragOrigin(sel);
    if (origin) {
      dragSeq += 1;
      drag = { kind: "move", sel, start: toWorld(view, p), origin: { ...origin }, key: `move:${sel.stair ?? sel.area}:${dragSeq}`, carry: textsInside(sel) };
    }
  } else {
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy, at: toWorld(view, p), moved: false };
    canvas.classList.add("panning");
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag && drawing) {
    const r = canvas.getBoundingClientRect();
    const { prev, at, kind } = snapForWall({ x: e.clientX - r.left, y: e.clientY - r.top }, e.altKey);
    hover = { from: prev, to: at, kind };
    drawCanvas();
    return;
  }
  if (!drag) return;
  if (drag.kind === "pan") {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
      drag.moved = true;
      manualView();
    }
    view = { ...view, ox: drag.ox + e.clientX - drag.startX, oy: drag.oy + e.clientY - drag.startY };
    drawCanvas();
    return;
  }
  const r = canvas.getBoundingClientRect();
  const w = toWorld(view, { x: e.clientX - r.left, y: e.clientY - r.top });
  if (drag.kind === "handle") {
    const d = drag;
    const f = findArea(store.state.sketch, d.sel);
    const st = (f?.area.stairs ?? []).find((x) => x.id === d.sel.stair);
    if (!st) return;
    const next = dragStairHandle(st, d.handle, w);
    if (next.width !== st.width || next.run1 !== st.run1 || next.run2 !== st.run2) {
      store.update(
        (draft) => {
          const t = (findArea(draft, d.sel)?.area.stairs ?? []).find((x) => x.id === d.sel.stair);
          if (t) Object.assign(t, next);
        },
        { coalesce: d.key },
      );
    }
    return;
  }
  if (drag.kind === "corner") {
    const d = drag;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startPx.x, e.clientY - d.startPx.y) < 3) return;
      d.moved = true;
      activeCorner = null;
    }
    const inch = snap;
    let delta: Point;
    if (d.normal) {
      // Slide the wall square to itself, in grid steps.
      const along = inch((w.x - d.start.x) * d.normal.x + (w.y - d.start.y) * d.normal.y);
      delta = { x: d.normal.x * along, y: d.normal.y * along };
    } else {
      const from = d.base[d.corners[0]!];
      if (!from) return;
      let to = { x: from.x + w.x - d.start.x, y: from.y + w.y - d.start.y };
      const tolFt = 10 / view.scale;
      // Snap onto another corner (other areas, or this outline's other corners)…
      const targets = [...areaVertices(d.sel.area), ...d.base.filter((_, i) => !d.corners.includes(i))];
      const hit = e.altKey ? undefined : targets.find((q) => Math.hypot(q.x - to.x, q.y - to.y) < tolFt);
      if (hit) {
        to = { ...hit };
      } else {
        to = e.altKey ? to : { x: inch(to.x), y: inch(to.y) };
        // …or line up square with the corners either side, so walls stay straight.
        const nb = [d.base[(d.corners[0]! - 1 + d.base.length) % d.base.length], d.base[(d.corners[0]! + 1) % d.base.length]];
        for (const q of nb) {
          if (!q || e.altKey) continue;
          if (Math.abs(q.x - to.x) < tolFt * 0.8) to.x = q.x;
          if (Math.abs(q.y - to.y) < tolFt * 0.8) to.y = q.y;
        }
      }
      delta = { x: to.x - from.x, y: to.y - from.y };
    }
    const r = moveCorners(d.vectors, d.origin, d.corners, delta);
    if (!r) return;
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (!f) return;
        f.area.vectors = r.vectors;
        f.area.origin = r.origin;
        setHiddenDims(f.area, remapHiddenDims(d.hidden, r.walls));
      },
      { coalesce: d.key },
    );
    return;
  }
  if (drag.kind === "iwall-corner") {
    const d = drag;
    const raw = { x: d.base.x + w.x - d.start.x, y: d.base.y + w.y - d.start.y };
    // Moves freely in any direction: onto a corner or a wall when near one, otherwise to the grid,
    // lining up square with the corners either side when close.
    const snapped = snapWallPoint(raw, null, wallSnapTargets(d.sel.iwall), {
      tol: WALL_SNAP_PX / view.scale,
      step: snapStep(),
      free: e.altKey,
      align: d.neighbours,
    });
    const r = moveCorners(d.vectors, d.origin, [d.corner], { x: snapped.at.x - d.base.x, y: snapped.at.y - d.base.y });
    if (!r) return;
    store.update(
      (draft) => {
        const wl = (findArea(draft, d.sel)?.area.walls ?? []).find((x) => x.id === d.sel.iwall);
        if (!wl) return;
        wl.vectors = r.vectors;
        wl.origin = r.origin;
      },
      { coalesce: d.key },
    );
    return;
  }
  if (drag.kind === "text") {
    const d = drag;
    const inch = snap;
    const next = { x: inch(d.at.x + w.x - d.start.x), y: inch(d.at.y + w.y - d.start.y) };
    store.update(
      (draft) => {
        const t = (draft.texts ?? []).find((x) => x.id === d.id);
        if (t) t.at = next;
      },
      { coalesce: d.key },
    );
    return;
  }
  if (drag.kind === "label") {
    const d = drag;
    d.moved = true;
    const inch = snap;
    const next = { x: inch(d.offset.x + w.x - d.start.x), y: inch(d.offset.y + w.y - d.start.y) };
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (f) f.area.label = next;
      },
      { coalesce: d.key },
    );
    return;
  }
  const d = drag;
  const proposed = { x: d.origin.x + w.x - d.start.x, y: d.origin.y + w.y - d.start.y };
  const found = findArea(store.state.sketch, d.sel);
  if (!found) return;
  let next: Point;
  if (d.sel.stair) {
    const st = (found.area.stairs ?? []).find((x) => x.id === d.sel.stair);
    if (!st) return;
    const mine = stairDrawing({ ...st, origin: d.origin }).parts.flat();
    next = snapMove(mine, areaVertices(), d.origin, proposed, e.altKey);
  } else if (d.sel.iwall) {
    const ar = areaResultFor(d.sel.area);
    const wr = ar?.walls.find((x) => x.wall.id === d.sel.iwall);
    if (!ar || !wr) return;
    const cur = wr.wall.origin;
    const mine = flatten(wr.path, Math.PI / 8).map((q) => ({ x: q.x - cur.x + d.origin.x, y: q.y - cur.y + d.origin.y }));
    next = snapMove(mine, wallSnapTargets(d.sel.iwall).points, d.origin, proposed, e.altKey);
  } else if (d.sel.zone) {
    const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === d.sel.area);
    const zr = ar?.zones.find((z) => z.zone.id === d.sel.zone);
    if (!ar || !zr) return;
    const cur = zr.zone.origin;
    const mine = flatten(zr.path, Math.PI / 8).map((q) => ({ x: q.x - cur.x + d.origin.x, y: q.y - cur.y + d.origin.y }));
    // Snap to the area's corners and to the other zones' corners.
    const targets = [
      ...flatten(ar.shape.path, Math.PI / 8),
      ...ar.zones.filter((z) => z.zone.id !== d.sel.zone).flatMap((z) => flatten(z.path, Math.PI / 8)),
    ];
    next = snapMove(mine, targets, d.origin, proposed, e.altKey);
  } else {
    const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === d.sel.area);
    if (!ar) return;
    const cur = ar.area.origin;
    // Outline points as they were at drag start (the outline moves with the origin).
    const pts = (ar.shape.path.segments.length ? flatten(ar.shape.path, Math.PI / 8) : [ar.shape.path.start]).map((q) => ({
      x: q.x - cur.x + d.origin.x,
      y: q.y - cur.y + d.origin.y,
    }));
    next = snapMove(pts, areaVertices(d.sel.area), d.origin, proposed, e.altKey);
  }
  const cur = dragOrigin(d.sel);
  if (cur && (cur.x !== next.x || cur.y !== next.y)) {
    store.update(
      (draft) => {
        const f = findArea(draft, d.sel);
        if (!f) return;
        if (d.sel.stair) {
          const st = (f.area.stairs ?? []).find((x) => x.id === d.sel.stair);
          if (st) st.origin = next;
        } else if (d.sel.iwall) {
          const wl = (f.area.walls ?? []).find((x) => x.id === d.sel.iwall);
          if (wl) wl.origin = next;
        } else if (d.sel.zone) {
          const z = f.area.zones.find((x) => x.id === d.sel.zone);
          if (z) z.origin = next;
        } else {
          // The area moves as a group: its stairs, zones, interior walls and the labels inside it go too.
          const dx = next.x - f.area.origin.x;
          const dy = next.y - f.area.origin.y;
          const shift = (q: Point): Point => ({ x: q.x + dx, y: q.y + dy });
          f.area.origin = next;
          for (const st of f.area.stairs ?? []) st.origin = shift(st.origin);
          for (const z of f.area.zones) z.origin = shift(z.origin);
          for (const wl of f.area.walls ?? []) wl.origin = shift(wl.origin);
          const carry = new Set(d.carry ?? []);
          for (const t of draft.texts ?? []) if (carry.has(t.id)) t.at = shift(t.at);
        }
      },
      { coalesce: d.key },
    );
  }
});

function endDrag() {
  if (drag?.kind === "pan" && drag.place) {
    const { moved, place } = drag;
    drag = null;
    canvas.classList.remove("panning");
    if (!moved) placeWallPoint(place.px, place.free);
    return;
  }
  // A click on an area label (no drag) picks it, so Delete can hide it.
  if (drag?.kind === "label" && !drag.moved) {
    const area = drag.sel.area;
    drag = null;
    pick({ kind: "label", area });
    return;
  }
  // A click on a corner (no drag) picks it for Delete wall.
  if (drag?.kind === "corner" && !drag.moved && !drag.normal) {
    const area = drag.sel.area;
    const index = drag.corners[0]!;
    store.select(drag.sel);
    activeCorner = activeCorner?.area === area && activeCorner.index === index ? null : { area, index };
    drag = null;
    drawCanvas();
    drawVectorBar();
    return;
  }
  // A click (not a pan) on empty space places the start point of an area that has no walls yet.
  if (drag?.kind === "pan" && !drag.moved) {
    const f = findArea(store.state.sketch, store.state.selection);
    if (f && f.area.vectors.trim() === "" && !store.state.selection?.zone) {
      const at = drag.at;
      const targets = areaVertices(f.area.id);
      const origin = snapMove([at], targets, at, at, false);
      editArea((a) => (a.origin = origin));
      vectors.focus();
    }
  }
  // A stair dropped inside another area now belongs to that area (it moves with it and counts there).
  if (drag?.kind === "move" && drag.sel.stair) {
    const d = drag;
    const struct = store.state.sketch.structures.find((s) => s.id === d.sel.structure);
    const st = (findArea(store.state.sketch, d.sel)?.area.stairs ?? []).find((x) => x.id === d.sel.stair);
    const moved = st && (st.origin.x !== d.origin.x || st.origin.y !== d.origin.y);
    const home = struct && st && moved ? stairHome(struct.areas, d.sel.area, st) : null;
    if (home && st) {
      const to = struct!.areas.find((a) => a.id === home)!;
      store.update(
        (draft) => {
          const s = draft.structures.find((x) => x.id === d.sel.structure)!;
          const src = s.areas.find((a) => a.id === d.sel.area)!;
          const dst = s.areas.find((a) => a.id === home)!;
          const i = (src.stairs ?? []).findIndex((x) => x.id === st.id);
          const [moving] = (src.stairs ?? []).splice(i, 1);
          (dst.stairs ??= []).push(moving!);
          return { structure: s.id, area: dst.id, stair: moving!.id };
        },
        { coalesce: d.key },
      );
      say(`Stair moved to ${to.name}`);
    }
  }
  const wasEdit = drag !== null && drag.kind !== "pan";
  drag = null;
  canvas.classList.remove("panning");
  if (wasEdit && autoFit) fit();
  store.breakCoalesce();
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("dblclick", (e) => {
  if (drawing) return; // the two clicks already ended the wall
  const labelEl = (e.target as Element).closest("[data-label]");
  if (!labelEl) return;
  const sel: Selection = { structure: labelEl.getAttribute("data-structure")!, area: labelEl.getAttribute("data-area")! };
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) delete f.area.label;
  });
});
canvas.addEventListener("pointercancel", endDrag);

new ResizeObserver(() => {
  canvasSize = measure();
  drawCanvas();
}).observe(canvas);

// ---------- tree ----------

const tree = $<HTMLDivElement>("tree");

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function drawTree() {
  const sel = store.state.selection;
  const html = result.structures
    .map((s) => {
      const items = s.areas
        .map((a) => {
          const selected = sel?.area === a.area.id ? " selected" : "";
          const warn = a.problems.length ? ` <span class="warn" title="${esc(a.problems.join("\n"))}">⚠</span>` : "";
          return `<li class="area-item${selected}" data-structure="${s.structure.id}" data-area="${a.area.id}"><span>${esc(a.area.name)}${warn}</span><span class="sf" title="${a.area.kind === "living" ? "Counted under ANSI" : "Area"}">${formatSqFt(a.area.kind === "living" ? a.ansi.counted : a.shape.area, 0)}</span></li>`;
        })
        .join("");
      const current = sel?.structure === s.structure.id ? " current" : "";
      return `<li><div class="structure${current}" data-structure="${s.structure.id}">${esc(s.structure.name)}</div><ul>${items}</ul></li>`;
    })
    .join("");
  tree.innerHTML = `<ul>${html}</ul>`;
}

tree.addEventListener("click", (e) => {
  const li = (e.target as Element).closest("[data-structure]");
  if (!li) return;
  const structure = li.getAttribute("data-structure")!;
  const area = li.getAttribute("data-area");
  if (area) {
    store.select({ structure, area });
  } else {
    const s = store.state.sketch.structures.find((x) => x.id === structure);
    const first = s?.areas[0];
    if (first) store.select({ structure, area: first.id });
  }
});

// ---------- properties ----------

const props = {
  panel: $<HTMLElement>("props"),
  form: $<HTMLElement>("props").querySelector(".form") as HTMLElement,
  name: $<HTMLInputElement>("p-name"),
  kind: $<HTMLSelectElement>("p-kind"),
  level: $<HTMLInputElement>("p-level"),
  grade: $<HTMLSelectElement>("p-grade"),
  ceiling: $<HTMLSelectElement>("p-ceiling"),
  finished: $<HTMLInputElement>("p-finished"),
  connected: $<HTMLInputElement>("p-connected"),
  ox: $<HTMLInputElement>("p-ox"),
  oy: $<HTMLInputElement>("p-oy"),
  override: $<HTMLInputElement>("p-override"),
  overrideBucket: $<HTMLSelectElement>("p-override-bucket"),
  overrideNote: $<HTMLTextAreaElement>("p-override-note"),
  overrideBox: $<HTMLDetailsElement>("override-box"),
  showLabel: $<HTMLInputElement>("p-show-label"),
  showDims: $<HTMLInputElement>("p-show-dims"),
  resetLabel: $<HTMLButtonElement>("btn-reset-label"),
};
const sprops = {
  panel: $<HTMLElement>("structure-props"),
  name: $<HTMLInputElement>("s-name"),
  kind: $<HTMLSelectElement>("s-kind"),
};

props.overrideBucket.innerHTML = BUCKETS.map((b) => `<option value="${b}">${esc(BUCKET_LABELS[b])}</option>`).join("");

/** Set an input's value from state unless the user is typing in it (or the change is an undo/open). */
function sync(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  if (el.value === value) return;
  if (!external && document.activeElement === el) return;
  el.value = value;
}
function syncCheck(el: HTMLInputElement, value: boolean) {
  if (el.checked !== value) el.checked = value;
}

const fmtCoord = (v: number) => (v < 0 ? `-${formatLength(-v)}` : formatLength(v));

function drawProps() {
  const found = findArea(store.state.sketch, store.state.selection);
  props.panel.classList.toggle("disabled", !found);
  sprops.panel.classList.toggle("disabled", !found);
  if (!found) return;
  const { area, structure } = found;
  $("copy-walls").classList.toggle("hidden", area.vectors.trim() !== "");
  const nHidden = area.hiddenDims?.length ?? 0;
  $("btn-show-dims").classList.toggle("hidden", nHidden === 0);
  $("btn-show-dims").textContent = `Show ${nHidden} hidden dimension${nHidden === 1 ? "" : "s"}`;
  sync(props.name, area.name);
  sync(props.kind, area.kind);
  sync(props.level, area.level);
  sync(props.grade, area.grade);
  sync(props.ceiling, area.ceiling);
  syncCheck(props.finished, area.finished);
  syncCheck(props.connected, area.connected);
  sync(props.ox, fmtCoord(area.origin.x));
  sync(props.oy, fmtCoord(area.origin.y));
  syncCheck(props.override, !!area.override);
  props.overrideBucket.disabled = !area.override;
  props.overrideNote.disabled = !area.override;
  sync(props.overrideBucket, area.override?.bucket ?? "gla");
  sync(props.overrideNote, area.override?.note ?? "");
  if (area.override && external) props.overrideBox.open = true;
  props.form.classList.toggle("non-living", area.kind !== "living");
  syncCheck(props.showLabel, !area.hideLabel);
  syncCheck(props.showDims, !area.hideDims);
  props.resetLabel.disabled = !area.label || !!area.hideLabel;
  sync(sprops.name, structure.name);
  sync(sprops.kind, structure.kind);
}

/** Store an area's hidden dimensions (no list at all when none are hidden). */
function setHiddenDims(a: Area, hidden: number[]) {
  if (hidden.length) a.hiddenDims = hidden;
  else delete a.hiddenDims;
}

function editArea(fn: (a: ReturnType<typeof newArea>) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel) return;
  store.update(
    (draft) => {
      const f = findArea(draft, sel);
      if (f) fn(f.area);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.area}` } : {},
  );
}

props.name.addEventListener("input", () => editArea((a) => (a.name = props.name.value), "name"));
props.level.addEventListener("input", () => editArea((a) => (a.level = props.level.value.trim()), "level"));
props.kind.addEventListener("change", () => editArea((a) => (a.kind = props.kind.value as AreaKind)));
props.grade.addEventListener("change", () => editArea((a) => (a.grade = props.grade.value as Grade)));
props.ceiling.addEventListener("change", () => editArea((a) => (a.ceiling = props.ceiling.value as CeilingBand)));
props.finished.addEventListener("change", () => editArea((a) => (a.finished = props.finished.checked)));
props.connected.addEventListener("change", () => editArea((a) => (a.connected = props.connected.checked)));

function coordInput(el: HTMLInputElement, axis: "x" | "y") {
  el.addEventListener("input", () => {
    const t = el.value.trim();
    const neg = t.startsWith("-");
    const v = parseLength(neg ? t.slice(1) : t);
    el.classList.toggle("invalid", v === null);
    if (v !== null) editArea((a) => (a.origin = { ...a.origin, [axis]: neg ? -v : v }), `origin-${axis}`);
  });
  el.addEventListener("blur", () => {
    external = true;
    drawProps();
    external = false;
  });
}
coordInput(props.ox, "x");
coordInput(props.oy, "y");

props.showLabel.addEventListener("change", () =>
  editArea((a) => {
    if (props.showLabel.checked) delete a.hideLabel;
    else a.hideLabel = true;
  }),
);
props.showDims.addEventListener("change", () =>
  editArea((a) => {
    if (props.showDims.checked) delete a.hideDims;
    else a.hideDims = true;
  }),
);
props.resetLabel.addEventListener("click", () => editArea((a) => delete a.label));

props.override.addEventListener("change", () =>
  editArea((a) => {
    if (props.override.checked) a.override = { bucket: props.overrideBucket.value as Bucket, note: props.overrideNote.value };
    else delete a.override;
  }),
);
props.overrideBucket.addEventListener("change", () =>
  editArea((a) => {
    if (a.override) a.override.bucket = props.overrideBucket.value as Bucket;
  }),
);
props.overrideNote.addEventListener("input", () =>
  editArea((a) => {
    if (a.override) a.override.note = props.overrideNote.value;
  }, "override-note"),
);

function editStructure(fn: (s: ReturnType<typeof newStructure>) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel) return;
  store.update(
    (draft) => {
      const s = draft.structures.find((x) => x.id === sel.structure);
      if (s) fn(s);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.structure}` } : {},
  );
}
sprops.name.addEventListener("input", () => editStructure((s) => (s.name = sprops.name.value), "sname"));
sprops.kind.addEventListener("change", () =>
  editStructure((s) => {
    s.kind = sprops.kind.value as StructureKind;
    // The name follows the type until it has been typed over.
    if (isDefaultStructureName(s.name)) {
      const others = store.state.sketch.structures.filter((x) => x.id !== s.id).map((x) => x.name);
      s.name = defaultStructureName(s.kind, others);
    }
  }),
);

// ---------- stairs ----------

const stairs = {
  panel: $<HTMLElement>("stairs-panel"),
  list: $<HTMLDivElement>("stair-list"),
  form: $<HTMLDivElement>("stair-form"),
  type: $<HTMLSelectElement>("st-type"),
  width: $<HTMLInputElement>("st-width"),
  dir: $<HTMLSelectElement>("st-dir"),
  run1: $<HTMLInputElement>("st-run1"),
  run2: $<HTMLInputElement>("st-run2"),
  turn: $<HTMLSelectElement>("st-turn"),
  rot: $<HTMLSelectElement>("st-rot"),
  x: $<HTMLInputElement>("st-x"),
  y: $<HTMLInputElement>("st-y"),
  plan: $<HTMLTextAreaElement>("st-plan"),
  count: $<HTMLInputElement>("st-count"),
  build: $<HTMLDivElement>("st-build"),
  planMsg: $<HTMLDivElement>("st-plan-msg"),
};
stairs.type.innerHTML = STAIR_TYPES.map((t) => `<option value="${t.value}">${esc(t.label)}</option>`).join("");

const STAIR_TYPE_SHORT: Record<string, string> = { straight: "Straight", landing: "Landing", l: "L", winder: "Winder", u: "U", steps: "Built" };

function selectedStair(): Stair | null {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  return f && sel?.stair ? ((f.area.stairs ?? []).find((s) => s.id === sel.stair) ?? null) : null;
}

function drawStairs() {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  // Only shown when the selected area has stairs; "+ Stair" in the Area panel adds one.
  stairs.panel.classList.toggle("hidden", !f || (f.area.stairs ?? []).length === 0);
  const list = f?.area.stairs ?? [];
  stairs.list.innerHTML = list.length
    ? list
        .map((st, i) => `<button data-stair="${esc(st.id)}" class="${sel?.stair === st.id ? "selected" : ""}">${i + 1}. ${STAIR_TYPE_SHORT[st.type]}</button>`)
        .join("")
    : `<span class="empty">None on this area</span>`;
  const st = selectedStair();
  stairs.form.classList.toggle("hidden", !st);
  if (!st) return;
  stairs.form.classList.toggle("one-flight", st.type === "straight");
  stairs.form.classList.toggle("no-turn", st.type === "straight" || st.type === "landing" || st.type === "steps");
  stairs.form.classList.toggle("steps", st.type === "steps");
  if (st.type === "steps") {
    sync(stairs.plan, st.plan ?? "");
    const built = stairPlan(st.plan ?? "", st.width);
    stairs.planMsg.classList.toggle("bad", built.errors.length > 0);
    stairs.planMsg.textContent = built.errors.length
      ? built.errors.join(" · ")
      : built.steps > 0
        ? `${built.steps} step${built.steps === 1 ? "" : "s"} · ${formatSqFt(built.footprint)} sf on plan. Arrows add steps, Landing and Winders add a place to turn.`
        : "Use the buttons, or type: 2u sq r8 is 2 steps up, a landing, 8 steps right.";
  }
  sync(stairs.type, st.type);
  sync(stairs.width, formatLength(st.width));
  sync(stairs.dir, st.direction);
  sync(stairs.run1, formatLength(st.run1));
  sync(stairs.run2, formatLength(st.run2));
  sync(stairs.turn, st.turn);
  sync(stairs.rot, String(((st.rotation % 360) + 360) % 360));
  sync(stairs.x, fmtCoord(st.origin.x));
  sync(stairs.y, fmtCoord(st.origin.y));
}

function editStair(fn: (s: Stair) => void, coalesce?: string) {
  const sel = store.state.selection;
  if (!sel?.stair) return;
  store.update(
    (draft) => {
      const f = findArea(draft, sel);
      const st = (f?.area.stairs ?? []).find((x) => x.id === sel.stair);
      if (st) fn(st);
    },
    coalesce ? { coalesce: `${coalesce}:${sel.stair}` } : {},
  );
}

stairs.list.addEventListener("click", (e) => {
  const b = (e.target as Element).closest("[data-stair]");
  const sel = store.state.selection;
  if (b && sel) store.select({ structure: sel.structure, area: sel.area, stair: b.getAttribute("data-stair")! });
});

$("btn-add-stair-2").addEventListener("click", () => $("btn-add-stair").click());

$("btn-add-stair").addEventListener("click", () => {
  setCollapsed(stairs.panel, false);
  const sel = store.state.selection;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area);
  if (!sel || !ar) return;
  // Start just inside the area's lower-left corner, sized to fit.
  const b = ar.shape.path.segments.length ? bounds(ar.shape.path) : { minX: ar.area.origin.x, minY: ar.area.origin.y, maxX: ar.area.origin.x + 14, maxY: ar.area.origin.y + 14 };
  const run1 = Math.max(3, Math.min(12, Math.floor(b.maxY - b.minY - 2)));
  const st = defaultStair({ id: newId("t"), origin: { x: Math.ceil(b.minX + 1), y: Math.ceil(b.minY + 1) }, run1 });
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (!f) return;
    (f.area.stairs ??= []).push(st);
    return { structure: sel.structure, area: sel.area, stair: st.id };
  });
});

$("btn-delete-stair").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel?.stair) return;
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) f.area.stairs = (f.area.stairs ?? []).filter((x) => x.id !== sel.stair);
    return { structure: sel.structure, area: sel.area };
  });
  say("Stair deleted (Ctrl+Z to undo)");
});

function rotateStair() {
  editStair((st) => (st.rotation = (st.rotation + 270) % 360)); // clockwise on screen
}
$("btn-rotate-stair").addEventListener("click", rotateStair);

stairs.type.addEventListener("change", () =>
  editStair((st) => {
    st.type = stairs.type.value as Stair["type"];
    // Start a built stair from something to see: a flight, a landing, a flight.
    if (st.type === "steps" && !(st.plan ?? "").trim()) st.plan = "4u sq r4";
  }),
);
stairs.plan.addEventListener("input", () => editStair((st) => (st.plan = stairs.plan.value), "plan"));
// The builder: each button adds a piece to the end, so the steps need not be remembered.
stairs.build.addEventListener("click", (e) => {
  const step = (e.target as Element).closest("[data-step]")?.getAttribute("data-step");
  const st = selectedStair();
  if (!step || !st) return;
  const n = Math.max(1, Math.round(Number(stairs.count.value)) || 1);
  const pieces = (st.plan ?? "").trim().split(/\s+/).filter(Boolean);
  if (step === "back") {
    // "rad 3rise" is one piece.
    const last = pieces.pop();
    if (last && /rise/.test(last) && /^rad/.test(pieces[pieces.length - 1] ?? "")) pieces.pop();
  } else if (step === "sq") pieces.push("sq");
  else if (step === "rad") pieces.push("rad", `${n}rise`);
  else pieces.push(`${n}${step}`);
  const plan = pieces.join(" ");
  external = true; // the box shows the result even if it has the caret
  editStair((s2) => (s2.plan = plan));
  external = false;
});
stairs.dir.addEventListener("change", () => editStair((st) => (st.direction = stairs.dir.value as Stair["direction"])));
stairs.turn.addEventListener("change", () => editStair((st) => (st.turn = stairs.turn.value as Stair["turn"])));
stairs.rot.addEventListener("change", () => editStair((st) => (st.rotation = Number(stairs.rot.value))));

function lengthField(el: HTMLInputElement, apply: (st: Stair, v: number) => void, key: string, allowNegative = false) {
  el.addEventListener("input", () => {
    const t = el.value.trim();
    const neg = allowNegative && t.startsWith("-");
    const v = parseLength(neg ? t.slice(1) : t);
    const ok = v !== null && (allowNegative || v > 0);
    el.classList.toggle("invalid", !ok);
    if (ok) editStair((st) => apply(st, neg ? -v! : v!), key);
  });
  el.addEventListener("blur", () => {
    el.classList.remove("invalid");
    external = true;
    drawStairs();
    external = false;
  });
}
lengthField(stairs.width, (st, v) => (st.width = v), "st-width");
lengthField(stairs.run1, (st, v) => (st.run1 = v), "st-run1");
lengthField(stairs.run2, (st, v) => (st.run2 = v), "st-run2");
lengthField(stairs.x, (st, v) => (st.origin = { ...st.origin, x: v }), "st-x", true);
lengthField(stairs.y, (st, v) => (st.origin = { ...st.origin, y: v }), "st-y", true);

// ---------- collapsible panels (remembered in this browser) ----------

const COLLAPSED_KEY = "sketch:collapsed";
let collapsed = new Set<string>();
try {
  collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]);
} catch {
  /* storage unavailable or bad */
}

function panelKey(panel: Element): string {
  return panel.id || (panel.querySelector("h2")?.textContent ?? "").trim().toLowerCase();
}

function setCollapsed(panel: Element, on: boolean) {
  panel.classList.toggle("collapsed", on);
  const key = panelKey(panel);
  if (on) collapsed.add(key);
  else collapsed.delete(key);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    /* storage unavailable */
  }
}

for (const panel of document.querySelectorAll(".panel")) {
  const h2 = panel.querySelector("h2");
  if (!h2) continue;
  h2.title = "Click to collapse or expand";
  if (collapsed.has(panelKey(panel))) panel.classList.add("collapsed");
  h2.addEventListener("click", () => setCollapsed(panel, !panel.classList.contains("collapsed")));
}

// ---------- ceiling zones and openings ----------

const zones = {
  panel: $<HTMLElement>("zones-panel"),
  list: $<HTMLDivElement>("zone-list"),
  form: $<HTMLDivElement>("zone-form"),
  name: $<HTMLInputElement>("z-name"),
  band: $<HTMLSelectElement>("z-band"),
  side: $<HTMLSelectElement>("z-side"),
  bandNew: $<HTMLSelectElement>("z-band-new"),
  depth: $<HTMLInputElement>("z-depth"),
  inset: $<HTMLInputElement>("z-inset"),
  slopeEdit: $<HTMLDivElement>("z-slope-edit"),
  eSide: $<HTMLSelectElement>("z-e-side"),
  eWall: $<HTMLInputElement>("z-e-wall"),
  eTop: $<HTMLInputElement>("z-e-top"),
  eRun: $<HTMLInputElement>("z-e-run"),
  slopeWall: $<HTMLInputElement>("z-slope-wall"),
  slopeTop: $<HTMLInputElement>("z-slope-top"),
  slopeRun: $<HTMLInputElement>("z-slope-run"),
};
const bandOptions = ZONE_BANDS.map((b) => `<option value="${b.value}">${esc(b.label)}</option>`).join("");
// The zone's own Ceiling list can also make it sloped (new zones get a slope from "Add slope").
zones.band.innerHTML = bandOptions + `<option value="sloped">Sloped ceiling</option>`;
zones.bandNew.innerHTML = bandOptions;

/** Area whose (empty) zones panel was opened with "+ Ceiling / opening". */
let zonesOpenFor: string | null = null;

$("btn-show-zones").addEventListener("click", () => {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f) return;
  zonesOpenFor = f.area.id;
  setCollapsed(zones.panel, false);
  drawZones();
  zones.panel.scrollIntoView({ block: "nearest" });
});
$("btn-hide-zones").addEventListener("click", () => {
  zonesOpenFor = null;
  drawZones();
});

function drawZones() {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  // Only shown when the selected area has zones, or "+ Ceiling / opening" was just pressed.
  if (zonesOpenFor && zonesOpenFor !== f?.area.id) zonesOpenFor = null;
  const show = !!f && f.area.kind === "living" && (f.area.zones.length > 0 || zonesOpenFor === f.area.id);
  zones.panel.classList.toggle("hidden", !show);
  $("btn-hide-zones").classList.toggle("hidden", !f || f.area.zones.length > 0);
  $("btn-show-zones").classList.toggle("hidden", !f || f.area.kind !== "living" || show);
  if (!f) return;
  const list = f.area.zones;
  zones.list.innerHTML = list.length
    ? list
        .map((z, i) => {
          const short = zoneShort(z);
          return `<button data-zone="${esc(z.id)}" class="${sel?.zone === z.id ? "selected" : ""}">${i + 1}. ${esc(z.name ? `${z.name} (${short})` : short)}</button>`;
        })
        .join("")
    : `<span class="empty">None — the whole area has the ceiling set above</span>`;
  const z = sel?.zone ? list.find((x) => x.id === sel.zone) : undefined;
  zones.form.classList.toggle("hidden", !z);
  if (!z) return;
  sync(zones.name, z.name ?? "");
  const sloped = z.band === "sloped";
  zones.slopeEdit.classList.toggle("hidden", !sloped);
  sync(zones.band, z.band);
  if (sloped && z.slope) {
    sync(zones.eSide, slopeSide(z.slope) ?? "");
    sync(zones.eWall, formatLength(z.slope.fromHeight));
    sync(zones.eTop, formatLength(z.slope.toHeight));
    sync(zones.eRun, formatLength(Math.hypot(z.slope.to.x - z.slope.from.x, z.slope.to.y - z.slope.from.y)));
  }
}

/** A length typed in a slope field, or null (and the field marked) if it isn't one. */
function slopeLength(input: HTMLInputElement, positive = false): number | null {
  const v = parseLength(input.value);
  const ok = v !== null && (positive ? v > 0 : v >= 0);
  input.classList.toggle("invalid", !ok);
  return ok ? v : null;
}

zones.eWall.addEventListener("input", () => {
  const v = slopeLength(zones.eWall);
  if (v !== null) editZone((z) => z.slope && (z.slope.fromHeight = v), "slope-wall");
});
zones.eTop.addEventListener("input", () => {
  const v = slopeLength(zones.eTop);
  if (v !== null) editZone((z) => z.slope && (z.slope.toHeight = v), "slope-top");
});
zones.eRun.addEventListener("input", () => {
  const v = slopeLength(zones.eRun, true);
  if (v === null) return;
  // Change how far the slope runs before the ceiling levels off; a plain strip grows or shrinks with it.
  const zr = selectedZoneResult();
  if (!zr) return;
  const outline = flatten(zr.path);
  editZone((z) => {
    if (!z.slope) return;
    const next = setSlopeRun({ origin: z.origin, vectors: z.vectors, slope: z.slope }, outline, v);
    z.origin = next.origin;
    z.vectors = next.vectors;
    z.slope = next.slope;
  }, "slope-run");
});

function editZone(fn: (z: Area["zones"][number]) => void, coalesce?: string) {
  const zoneId = store.state.selection?.zone;
  if (!zoneId) return;
  editArea((a) => {
    const z = a.zones.find((x) => x.id === zoneId);
    if (z) fn(z);
  }, coalesce ? `${coalesce}-${zoneId}` : undefined);
}

zones.list.addEventListener("click", (e) => {
  const b = (e.target as Element).closest("[data-zone]");
  const sel = store.state.selection;
  if (b && sel) store.select({ structure: sel.structure, area: sel.area, zone: b.getAttribute("data-zone")! });
});
zones.name.addEventListener("input", () =>
  editZone((z) => {
    const v = zones.name.value.trim();
    if (v) z.name = v;
    else delete z.name;
  }, "zone-name"),
);
/** The selected zone's computed result (outline, area), if any. */
function selectedZoneResult() {
  const sel = store.state.selection;
  return result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area)?.zones.find((z) => z.zone.id === sel?.zone);
}

zones.band.addEventListener("change", () => {
  const kind = zones.band.value as ZoneKind;
  if (kind !== "sloped") {
    editZone((z) => {
      z.band = kind;
      delete z.slope;
    });
    return;
  }
  // Make it sloped: low along the side chosen under "Add a zone", rising across the whole zone,
  // with the heights from there too. Adjust them in the fields that appear.
  const zr = selectedZoneResult();
  if (!zr || zr.path.segments.length === 0) {
    say("Type the zone's outline first, then make it sloped");
    sync(zones.band, zr?.zone.band ?? "full");
    return;
  }
  const b = bounds(zr.path);
  const side = zones.side.value as Side;
  const wall = parseLength(zones.slopeWall.value) ?? 2;
  const top = parseLength(zones.slopeTop.value) ?? 8;
  const run = depthFrom(b, side);
  editZone((z) => {
    z.band = "sloped";
    z.slope = slopeFromSide(b, z.origin, side, run, wall, top);
  });
});

zones.eSide.addEventListener("change", () => {
  const zr = selectedZoneResult();
  if (!zr?.zone.slope || zr.path.segments.length === 0) return;
  const side = zones.eSide.value as Side;
  const b = bounds(zr.path);
  const { from, to, fromHeight, toHeight } = zr.zone.slope;
  // Keep the heights; keep the run unless it no longer fits the zone that way.
  const run = Math.min(Math.hypot(to.x - from.x, to.y - from.y), depthFrom(b, side));
  editZone((z) => (z.slope = slopeFromSide(b, z.origin, side, run, fromHeight, toHeight)));
});

function addZone(z: Omit<Area["zones"][number], "id">) {
  setCollapsed(zones.panel, false);
  const sel = store.state.selection;
  if (!sel) return;
  const id = newId("z");
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (!f) return;
    f.area.zones.push({ id, ...z });
    return { structure: sel.structure, area: sel.area, zone: id };
  });
}

$("btn-add-strip").addEventListener("click", () => {
  const sel = store.state.selection;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area);
  if (!ar || ar.shape.path.segments.length === 0) {
    say("Draw the area's walls first");
    return;
  }
  const depth = parseLength(zones.depth.value);
  const inset = parseLength(zones.inset.value) ?? 0;
  if (depth === null || depth <= 0) {
    zones.depth.classList.add("invalid");
    say("Enter a depth like 4' or 3'6\"");
    return;
  }
  zones.depth.classList.remove("invalid");
  const strip = stripZone(bounds(ar.shape.path), zones.side.value as Side, depth, inset);
  addZone({ band: zones.bandNew.value as ZoneBand, ...strip });
});

$("btn-add-slope").addEventListener("click", () => {
  const sel = store.state.selection;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel?.area);
  if (!ar || ar.shape.path.segments.length === 0) {
    say("Draw the area's walls first");
    return;
  }
  const wall = slopeLength(zones.slopeWall);
  const top = slopeLength(zones.slopeTop);
  const run = slopeLength(zones.slopeRun, true);
  if (wall === null || top === null || run === null) {
    say("Enter heights and a distance like 2', 7'6\" and 6'");
    return;
  }
  const strip = slopeStrip(bounds(ar.shape.path), zones.side.value as Side, run, wall, top);
  addZone({ band: "sloped", ...strip });
});

$("btn-add-zone").addEventListener("click", () => {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f) return;
  addZone({ band: zones.bandNew.value as ZoneBand, origin: { ...f.area.origin }, vectors: "" });
  vectors.focus();
});

$("btn-delete-zone").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel?.zone) return;
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (f) f.area.zones = f.area.zones.filter((z) => z.id !== sel.zone);
    return { structure: sel.structure, area: sel.area };
  });
  say("Zone deleted (Ctrl+Z to undo)");
});

// ---------- vector bar ----------

/** Put a typed character at the end of the walls box and carry on typing there. */
function typeIntoWalls(ch: string) {
  if (vectors.disabled) return;
  vectors.focus();
  const end = vectors.value.length;
  // Start a new word after a finished one (A or CL closes; "a24" would be a typo).
  const sep = /\b(?:a|cl|close)$/i.test(vectors.value) && /\S/.test(ch) ? " " : "";
  vectors.setRangeText(sep + ch, end, end, "end");
  vectors.dispatchEvent(new Event("input"));
}

const vectors = $<HTMLTextAreaElement>("vectors");
const vstatus = $<HTMLDivElement>("vector-status");

vectors.addEventListener("input", () => {
  // Tablet keyboards type curly quotes; keep plain ' and " in the box (same length, so the caret stays put).
  const plain = straightQuotes(vectors.value);
  if (plain !== vectors.value) {
    const { selectionStart, selectionEnd } = vectors;
    vectors.value = plain;
    vectors.setSelectionRange(selectionStart, selectionEnd);
  }
  const zoneId = store.state.selection?.zone;
  const iwallId = store.state.selection?.iwall;
  const now = findArea(store.state.sketch, store.state.selection)?.area;
  // One undo step per wall typed or deleted, not one for everything typed in the box.
  const step = (base: string, before: string | undefined) => typingStep(base, before ?? "", vectors.value);
  if (iwallId) {
    const before = (now?.walls ?? []).find((x) => x.id === iwallId)?.vectors;
    editArea((a) => {
      const wl = (a.walls ?? []).find((x) => x.id === iwallId);
      if (wl) wl.vectors = vectors.value;
    }, step(`iwall-vectors-${iwallId}`, before));
  } else if (zoneId) {
    const before = now?.zones.find((x) => x.id === zoneId)?.vectors;
    editArea((a) => {
      const z = a.zones.find((x) => x.id === zoneId);
      if (z) z.vectors = vectors.value;
    }, step(`zone-vectors-${zoneId}`, before));
  } else {
    editArea((a) => (a.vectors = vectors.value), step("vectors", now?.vectors));
  }
});

/** A tall walls box that grows with its text (5 to 14 lines), so the outline reads as a list of walls. */
function fitVectorsBox() {
  const rows = Math.min(14, Math.max(5, vectors.value.split("\n").length + 1));
  if (vectors.rows !== rows) vectors.rows = rows;
}

const ARROWS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** "30" then an arrow key → "U30 ". Returns true if it handled the key. */
/**
 * After an arrow key makes a wall, arrows along it lengthen or shorten that
 * wall one step at a time until Enter (or any typing) moves on. Holds the
 * area it applies to.
 */
let adjusting: string | null = null;
/** Walls are being entered with the arrow keys, so an arrow at the end of the box makes a wall rather than moving the caret. */
let arrowsArmed = false;
/** Which area or zone the walls box is showing. */
let vectorsFor = "";

function arrowIntoWalls(key: string, atEnd: boolean, shift = false): boolean {
  const dir = ARROWS[key];
  if (!dir || vectors.disabled) return false;
  const caret = atEnd ? vectors.value.length : (vectors.selectionStart ?? vectors.value.length);
  if (!atEnd && vectors.selectionStart !== vectors.selectionEnd) return false;
  const area = store.state.selection?.area ?? null;
  let r = shift ? null : applyArrow(vectors.value, caret, dir);
  if (r) {
    adjusting = area;
  } else if (adjusting && adjusting === area) {
    r = adjustLastWall(vectors.value, caret, dir, shift ? 1 : smallStep());
    if (!r) return true; // crosswise arrow while adjusting: ignore rather than move the caret
  }
  // No length waiting and no wall being adjusted: the arrow runs a wall to the next corner that way.
  if (!r) return shift ? false : arrowSkip(dir, atEnd);
  vectors.value = r.text;
  vectors.setSelectionRange(r.caret, r.caret);
  vectors.dispatchEvent(new Event("input", { bubbles: false }));
  // The input handler clears adjusting for typed edits; keep it for ours.
  adjusting = area;
  drawVectorBar();
  return true;
}

/** Enter while adjusting: done with this wall. */
function endAdjust(): boolean {
  if (!adjusting) return false;
  adjusting = null;
  arrowsArmed = true; // still entering by arrow keys: the next arrow may run to a corner
  if (!/\s$/.test(vectors.value) && vectors.value !== "") {
    vectors.value += " ";
    vectors.dispatchEvent(new Event("input"));
  }
  drawVectorBar();
  return true;
}

/** The walls text a skip left behind and its direction: Enter again straight after carries on the same way. */
let lastSkip: { text: string; dir: string } | null = null;

/** Where a skip measures from, and the corners it may line up with (outlines and zones, not interior walls). */
function skipContext(): { origin: { x: number; y: number }; others: { x: number; y: number }[] } | null {
  const sel = store.state.selection;
  const found = findArea(store.state.sketch, sel);
  if (!found || vectors.disabled || sel?.iwall) return null;
  const zone = sel?.zone ? found.area.zones.find((z) => z.id === sel.zone) : undefined;
  if (sel?.zone && !zone) return null;
  // Corners of the other areas count too: line a wall up with the floor below or the garage.
  const others = zone
    ? corners(found.area.vectors, found.area.origin)
    : store.state.sketch.structures.flatMap((s) => s.areas).filter((a) => a.id !== found.area.id).flatMap((a) => corners(a.vectors, a.origin));
  return { origin: (zone ?? found.area).origin, others };
}

function applySkip(r: { text: string; caret: number }, dir: string) {
  vectors.value = r.text;
  vectors.setSelectionRange(r.caret, r.caret);
  vectors.dispatchEvent(new Event("input"));
  lastSkip = { text: r.text, dir };
}

/**
 * "L" then Enter → a wall left as far as the next corner already drawn.
 * Enter again, with nothing typed since, carries the same wall on to the
 * corner after that.
 */
function skipIntoWalls(): boolean {
  const ctx = skipContext();
  if (!ctx || vectors.selectionStart !== vectors.selectionEnd) return false;
  const caret = vectors.selectionStart ?? vectors.value.length;
  let again = false;
  let r = skipToCorner(vectors.value, caret, ctx.origin, ctx.others);
  let dir = /([lrud])$/i.exec(vectors.value.slice(0, caret))?.[1] ?? "";
  if (!r && lastSkip && vectors.value === lastSkip.text && caret === vectors.value.length) {
    again = true;
    dir = lastSkip.dir;
    r = skipToCorner(vectors.value + dir, vectors.value.length + 1, ctx.origin, ctx.others);
  }
  if (!r) {
    if (again) say("No corner further that way");
    return again; // a repeat with nowhere to go: stay put rather than add blank lines
  }
  applySkip(r, dir);
  return true;
}

/**
 * An arrow key with no length typed: a wall that way as far as the next
 * corner already drawn; the same arrow again carries it on. On the drawing
 * it always applies. In the walls box only at the end, on an empty line, so
 * the arrows still move the caret everywhere else.
 */
function arrowSkip(dir: "up" | "down" | "left" | "right", onDrawing: boolean): boolean {
  const ctx = skipContext();
  if (!ctx) return false;
  const text = vectors.value;
  const blank = text === "" || /[\s,]$/.test(text);
  if (!onDrawing) {
    const caret = vectors.selectionStart ?? text.length;
    if (caret !== text.length || vectors.selectionEnd !== caret) return false;
    if (!(text === "" || text.endsWith("\n") || arrowsArmed)) return false;
  }
  const letter = { up: "U", down: "D", left: "L", right: "R" }[dir];
  const base = blank ? text : `${text} `;
  const r = skipToCorner(base + letter, base.length + 1, ctx.origin, ctx.others);
  if (!r) {
    if (onDrawing || text !== "") say("No corner further that way");
    return onDrawing; // in the box, let the arrow move the caret
  }
  applySkip(r, letter);
  arrowsArmed = true;
  return true;
}

/** "L24" then a → "L24 A": A closes the outline even typed straight after a wall. */
function closeKeyIntoWalls(atEnd: boolean): boolean {
  if (vectors.disabled) return false;
  const caret = atEnd ? vectors.value.length : (vectors.selectionStart ?? vectors.value.length);
  if (!atEnd && vectors.selectionStart !== vectors.selectionEnd) return false;
  const before = vectors.value.slice(0, caret);
  if (before === "" || /[\s,]$/.test(before)) return false; // a token start: A may begin a polar move (A30:12)
  if (/#[^\n]*$/.test(before)) return false; // inside a # comment: an ordinary letter
  vectors.setRangeText(" A", caret, caret, "end");
  vectors.dispatchEvent(new Event("input"));
  return true;
}

vectors.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key in ARROWS) {
    if (arrowIntoWalls(e.key, false, e.shiftKey)) e.preventDefault();
    return;
  }
  if (e.key === "Enter" && endAdjust()) {
    e.preventDefault();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && skipIntoWalls()) {
    e.preventDefault();
    return;
  }
  if (e.key !== "Shift") {
    adjusting = null; // typing moves on
    arrowsArmed = false;
  }
  if (e.key.toLowerCase() === "a" && closeKeyIntoWalls(false)) e.preventDefault();
});

const vectorLabel = document.querySelector<HTMLLabelElement>(".vector-label")!;

/** One line on how the area's ceiling zones and openings are counted. */
function zoneBreakdown(r: AreaResult): string {
  if (r.zones.length === 0 || r.area.kind !== "living") return "";
  const a = r.ansi;
  const bits = [
    a.full > 0.05 ? `7'+ ${formatSqFt(a.full)}` : "",
    a.reduced > 0.05 ? `5'–7' ${formatSqFt(a.reduced)}` : "",
    a.low > 0.05 ? `under 5' ${formatSqFt(a.low)} (not counted)` : "",
    a.opening > 0.05 ? `open ${formatSqFt(a.opening)} (not counted)` : "",
  ].filter(Boolean);
  return `<div>Ceilings: ${bits.join(" · ")}</div>`;
}

function drawVectorBar() {
  drawVectorBarContent();
  fitVectorsBox();
}

function drawVectorBarContent() {
  const sel = store.state.selection;
  const found = findArea(store.state.sketch, sel);
  vectors.disabled = !found;
  if (!found) {
    vectors.value = "";
    vstatus.textContent = "Select or add an area.";
    return;
  }
  const r = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === found.area.id);
  if (!r) return;
  const wr = sel?.iwall ? r.walls.find((x) => x.wall.id === sel.iwall) : undefined;
  // Templates replace the area's outline: offer them only while the box shows that outline.
  const outlineShown = !sel?.iwall && !sel?.zone && !drawing;
  tpl.box.classList.toggle("hidden", !outlineShown);
  if (!outlineShown) tpl.box.open = false;
  if (drawing && !drawing.wall && !wr) {
    // Drawing, start not placed yet: the box would otherwise edit the area's outline.
    vectorLabel.textContent = "Interior wall";
    vectors.disabled = true;
    vectors.value = "";
    vectorsFor = "";
    vstatus.innerHTML =
      `Click where the wall starts: it snaps to corners, along walls and to the grid (Alt: no snapping). ` +
      `<span class="hint">Enter or Esc stops drawing; drag to pan.</span>`;
    return;
  }
  if (wr) {
    vectorLabel.textContent = "Interior wall";
    const showing = `iwall:${wr.wall.id}`;
    if (showing !== vectorsFor) {
      vectorsFor = showing;
      vectors.value = wr.wall.vectors;
      adjusting = null;
    } else {
      sync(vectors, wr.wall.vectors);
    }
    const n = wr.path.segments.length;
    const total = wr.path.segments.reduce((t, sg) => t + Math.hypot(sg.to.x - sg.from.x, sg.to.y - sg.from.y), 0);
    const bits = [
      n === 0 ? "Click each corner, or type walls from the start point (e.g. <b>U12 R8</b>)" : `${n} wall${n === 1 ? "" : "s"}, ${formatLength(total)} long`,
      "floor plan only; never changes the area",
      wr.inside ? "" : `<span class="bad">extends outside ${esc(found.area.name)}</span>`,
    ].filter(Boolean);
    const actions = [
      drawing ? `<span class="hint">Double-click to end this wall; Enter or Esc stops drawing.</span>` : "",
      n > 0 ? `<button class="inline" data-action="delete">Delete last wall</button>` : "",
      `<button class="inline" data-action="delete-iwall">Delete interior wall</button>`,
      drawing ? "" : `<span class="hint">Drag it to move it, or drag its ends and bends.</span>`,
    ].filter(Boolean);
    const errs = wr.errors.map((e) => `"${e.text}": ${e.message}`);
    vstatus.innerHTML =
      bits.join(" · ") +
      `<div class="actions">${actions.join(" ")}</div>` +
      (errs.length ? `<ul>${errs.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "");
    return;
  }
  const zr = sel?.zone ? r.zones.find((z) => z.zone.id === sel.zone) : undefined;
  vectorLabel.textContent = zr ? "Zone" : "Walls";
  // Always refresh when the box switches to another area or zone, even while it has focus,
  // so one area's text can never be typed into another.
  const showing = zr ? `zone:${zr.zone.id}` : `area:${found.area.id}`;
  if (showing !== vectorsFor) {
    vectorsFor = showing;
    vectors.value = zr ? zr.zone.vectors : found.area.vectors;
    adjusting = null;
  } else {
    sync(vectors, zr ? zr.zone.vectors : found.area.vectors);
  }
  if (zr) {
    const band = zoneLabel(zr.zone);
    const bits = [
      zr.path.segments.length === 0
        ? "Type the zone outline from its start point"
        : zr.closure.closed
          ? `<span class="ok">✓ closed</span>`
          : `<span class="bad">open (${closingMove(zr.closure.dx, zr.closure.dy)} to close)</span>`,
      `${formatSqFt(zr.area)} sf`,
      esc(band),
      zr.inside ? "" : `<span class="bad">extends outside ${esc(found.area.name)}</span>`,
    ].filter(Boolean);
    vstatus.innerHTML = bits.join(" · ") + zoneBreakdown(r);
    return;
  }
  const sh = r.shape;
  if (sh.path.segments.length === 0) {
    vstatus.innerHTML = "Type walls from the start point, e.g. <b>R24 U30 L24 D30</b>.";
    return;
  }
  const parts: string[] = [];
  if (sh.closure.closed) parts.push(`<span class="ok">✓ closed</span>`);
  else
    parts.push(
      `<span class="bad">open: misses the start by ${formatLength(sh.closure.distance)} ` +
        `(${closingMove(sh.closure.dx, sh.closure.dy)} to close)</span>`,
    );
  parts.push(`${formatSqFt(sh.area)} sf`, `perimeter ${formatLength(sh.perimeter)}`);
  if (r.ansi.bucket !== "excluded" || r.ansi.counted > 0) parts.push(`→ ${BUCKET_LABELS[r.ansi.bucket]} ${formatSqFt(r.ansi.counted)} sf`);
  const actions: string[] = [];
  if (adjusting === r.area.id && sh.path.segments.length > 0) {
    const unit = lengthStyle() === "decimal" ? "0.1'" : '1"';
    actions.push(`<span class="ok">Adjusting the last wall:</span> arrows along it lengthen or shorten it ${unit} (Shift: 1'); <b>Enter</b> for the next wall.`);
  }
  const cornerHere = activeCorner?.area === r.area.id ? activeCorner.index : null;
  if (sh.closure.closed && cornerHere !== null) {
    actions.push(
      `Corner ${cornerHere + 1}: arrow keys move it ${lengthStyle() === "decimal" ? "0.1'" : '1"'} (Shift: 1'). <button class="inline" data-action="delete">Delete wall</button> leaving this corner (opens the outline here; press again to keep going back)`,
    );
  } else if (sh.closure.closed) {
    actions.push(`<span class="hint">Click a corner to delete the wall leaving it, or Backspace on the drawing removes the last wall.</span>`);
  } else if (sh.path.segments.length > 0) {
    actions.push(
      `<button class="inline" data-action="delete">Delete last wall</button> <button class="inline" data-action="close">Close (A)</button> <span class="hint">or keep typing back to the start.</span>`,
    );
  }
  const problems = r.problems.filter((p) => !p.startsWith("outline does not close"));
  vstatus.innerHTML =
    parts.join(" · ") +
    zoneBreakdown(r) +
    `<div class="actions">${actions.join(" ")}</div>` +
    (problems.length ? `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "");
}

/** The picked corner, if it belongs to the selected area. */
function cornerToNudge(): { area: string; index: number } | null {
  const sel = store.state.selection;
  return activeCorner && sel?.area === activeCorner.area && !sel.stair && !sel.zone && !sel.iwall ? activeCorner : null;
}

function nudgeCorner(dir: "up" | "down" | "left" | "right", step: number) {
  const c = cornerToNudge();
  const f = findArea(store.state.sketch, store.state.selection);
  if (!c || !f) return;
  const d = { up: { x: 0, y: step }, down: { x: 0, y: -step }, left: { x: -step, y: 0 }, right: { x: step, y: 0 } }[dir];
  const r = moveCorners(f.area.vectors, f.area.origin, [c.index], d);
  if (!r) return;
  // Held or repeated presses on one corner are a single undo step.
  editArea((a) => {
    a.vectors = r.vectors;
    a.origin = r.origin;
    setHiddenDims(a, remapHiddenDims(a.hiddenDims, r.walls));
  }, `nudge-${c.area}-${c.index}`);
}

/** Wall text after a wall is taken off: a trailing space, so the next wall typed starts a new word ("U12 R8", not "U12R8", one diagonal wall). */
function readyToType(text: string): string {
  return text === "" || /\s$/.test(text) ? text : `${text} `;
}

/** Delete the wall leaving the picked corner (closed outline) or the last wall, stepping the pen back. */
function deleteWallAction(): boolean {
  const f = findArea(store.state.sketch, store.state.selection);
  const iwallId = store.state.selection?.iwall;
  if (f && iwallId) {
    // Interior wall: take off its last segment.
    const wl = (f.area.walls ?? []).find((x) => x.id === iwallId);
    const r = wl ? deleteWall(wl.vectors, wl.origin, null) : null;
    if (!r) return false;
    editArea((a) => {
      const t = (a.walls ?? []).find((x) => x.id === iwallId);
      if (t) t.vectors = readyToType(r.vectors);
    });
    external = true;
    drawVectorBar();
    external = false;
    return true;
  }
  if (!f || store.state.selection?.zone || store.state.selection?.stair) return false;
  const corner = activeCorner?.area === f.area.id ? activeCorner.index : null;
  const r = deleteWall(f.area.vectors, f.area.origin, corner);
  if (!r) return false;
  const wasClosed = corner !== null;
  activeCorner = null;
  editArea((a) => {
    a.vectors = readyToType(r.vectors);
    a.origin = r.origin;
    setHiddenDims(a, remapHiddenDims(a.hiddenDims, r.walls));
  });
  external = true;
  drawVectorBar();
  external = false;
  if (wasClosed) say("Wall deleted: type walls from the corner, back to the start (or A) to close");
  return true;
}

/** Remove the selected interior wall. */
function deleteInteriorWall(): boolean {
  const sel = store.state.selection;
  if (!sel?.iwall) return false;
  if (drawing?.wall === sel.iwall) drawing.wall = null;
  store.update((draft) => {
    const f = findArea(draft, sel);
    if (!f) return;
    f.area.walls = (f.area.walls ?? []).filter((x) => x.id !== sel.iwall);
    if (f.area.walls.length === 0) delete f.area.walls;
    return { structure: sel.structure, area: sel.area };
  });
  say("Interior wall deleted (Ctrl+Z to undo)");
  return true;
}

vstatus.addEventListener("click", (e) => {
  const action = (e.target as Element).closest("[data-action]")?.getAttribute("data-action");
  const f = findArea(store.state.sketch, store.state.selection);
  if (!action || !f) return;
  if (action === "delete-iwall") {
    deleteInteriorWall();
    canvas.focus();
  } else if (action === "delete") {
    deleteWallAction();
    vectors.focus();
    vectors.setSelectionRange(vectors.value.length, vectors.value.length);
  } else if (action === "close") {
    editArea((a) => (a.vectors = closeOutline(a.vectors)));
    vectors.focus();
  }
});

// ---------- templates ----------

const tpl = {
  box: $<HTMLDetailsElement>("tpl"),
  select: $<HTMLSelectElement>("tpl-select"),
  params: $<HTMLDivElement>("tpl-params"),
  msg: $<HTMLDivElement>("tpl-msg"),
};
tpl.select.innerHTML = TEMPLATES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join("");

function drawTemplateParams() {
  const t = TEMPLATES.find((x) => x.id === tpl.select.value) ?? TEMPLATES[0]!;
  tpl.params.innerHTML = t.params
    .map((p) => `<label>${esc(p.label)} <input type="text" inputmode="decimal" data-key="${p.key}" value="${esc(formatLength(p.value))}"/></label>`)
    .join("");
  tpl.msg.textContent = "";
}
tpl.select.addEventListener("change", drawTemplateParams);
drawTemplateParams();

/** Read the template form; returns vectors (and kind) or shows why not. */
function templateResult(): { vectors: string; kind?: AreaKind; label: string } | null {
  const t = TEMPLATES.find((x) => x.id === tpl.select.value);
  if (!t) return null;
  const values: Record<string, number> = {};
  for (const input of tpl.params.querySelectorAll<HTMLInputElement>("input[data-key]")) {
    const v = parseLength(input.value);
    input.classList.toggle("invalid", v === null);
    if (v === null) {
      tpl.msg.textContent = "Enter lengths like 24, 24.5 or 24'6\"";
      return null;
    }
    values[input.dataset.key!] = v;
  }
  const problem = checkTemplate(t, values);
  tpl.msg.textContent = problem ?? "";
  if (problem) return null;
  return t.kind ? { vectors: t.build(values), kind: t.kind, label: t.label } : { vectors: t.build(values), label: t.label };
}

$("tpl-apply").addEventListener("click", () => {
  const r = templateResult();
  if (!r) return;
  editArea((a) => {
    a.vectors = r.vectors;
    delete a.hiddenDims; // a new outline: the old wall numbers mean nothing
    if (r.kind) a.kind = r.kind;
  });
  tpl.box.open = false;
  fit();
});

$("tpl-new").addEventListener("click", () => {
  const r = templateResult();
  const sel = store.state.selection;
  if (!r) return;
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel?.structure) ?? draft.structures[0];
    if (!s) return null;
    const a = newArea({ name: r.label, origin, vectors: r.vectors, ...(r.kind ? { kind: r.kind } : {}) });
    s.areas.push(a);
    return { structure: s.id, area: a.id };
  });
  tpl.box.open = false;
  fit();
});

// ---------- report header ----------

type MetaKey = "subject";
const metaFields: [string, MetaKey][] = [["m-subject", "subject"]];
for (const [id, key] of metaFields) {
  const el = $<HTMLInputElement>(id);
  el.addEventListener("input", () =>
    store.update(
      (draft) => {
        const v = el.value;
        if (v.trim() === "") delete draft.meta[key];
        else draft.meta[key] = v;
      },
      { coalesce: `meta-${key}` },
    ),
  );
}
function drawMeta() {
  for (const [id, key] of metaFields) sync($<HTMLInputElement>(id), store.state.sketch.meta[key] ?? "");
}

// ---------- hiding single dimensions and area labels ----------

/** A wall dimension or area label picked on the drawing (Delete hides it). */
let picked: { kind: "dim" | "label"; area: string; wall?: number } | null = null;

function pick(p: typeof picked) {
  picked = p;
  drawCanvas();
  if (p) say(p.kind === "dim" ? "Press Delete to hide this dimension (double-click hides it too)" : "Press Delete to hide this label");
}

function hidePicked() {
  const p = picked;
  if (!p) return;
  picked = null;
  store.update((draft) => {
    const a = draft.structures.flatMap((s) => s.areas).find((x) => x.id === p.area);
    if (!a) return;
    if (p.kind === "label") a.hideLabel = true;
    else a.hiddenDims = [...new Set([...(a.hiddenDims ?? []), p.wall!])].sort((x, y) => x - y);
  });
  say(p.kind === "label" ? "Label hidden — tick Label in the Area panel to show it" : "Dimension hidden — Show hidden dimensions in the Area panel brings it back");
}

canvas.addEventListener("dblclick", (e) => {
  const dimEl = (e.target as Element).closest("[data-dim]");
  if (!dimEl) return;
  pick({ kind: "dim", area: dimEl.getAttribute("data-area")!, wall: Number(dimEl.getAttribute("data-dim")) });
  hidePicked();
});

$("btn-show-dims").addEventListener("click", () => editArea((a) => delete a.hiddenDims));

// ---------- room labels ----------

let selectedText: string | null = null;
const labelText = $<HTMLInputElement>("label-text");
const labelCustom = $<HTMLInputElement>("label-custom");
const labelGroups = $("label-groups");

// "My labels": custom names the user chose to keep, saved in this browser.
const MY_LABELS_KEY = "sketch:my-labels";
const OPEN_GROUPS_KEY = "sketch:label-groups-open";
function loadList(key: string, fallback: string[]): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;
  } catch {
    return fallback;
  }
}
function saveList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}
let myLabels = loadList(MY_LABELS_KEY, []);
const openGroups = new Set(loadList(OPEN_GROUPS_KEY, ["My labels", "Rooms"]));

function drawLabelGroups() {
  const chip = (t: string, mine = false) =>
    `<button data-label-text="${esc(t)}">${esc(t)}${mine ? `<span class="x" data-forget="${esc(t)}" title="Remove from My labels">×</span>` : ""}</button>`;
  const groups = [
    ...(myLabels.length ? [{ name: "My labels", labels: myLabels, mine: true }] : []),
    ...LABEL_GROUPS.map((g) => ({ ...g, mine: false })),
  ];
  labelGroups.innerHTML = groups
    .map(
      (g) =>
        `<details data-group="${esc(g.name)}"${openGroups.has(g.name) ? " open" : ""} class="${g.mine ? "mine" : ""}"><summary>${esc(g.name)}</summary>` +
        `<div class="chips">${g.labels.map((t) => chip(t, g.mine)).join("")}</div></details>`,
    )
    .join("");
  updateLabelCount();
}
drawLabelGroups();

labelGroups.addEventListener(
  "toggle",
  (e) => {
    const d = e.target as HTMLDetailsElement;
    const name = d.getAttribute("data-group");
    if (!name) return;
    if (d.open) openGroups.add(name);
    else openGroups.delete(name);
    saveList(OPEN_GROUPS_KEY, [...openGroups]);
  },
  true,
);

function keepLabel(text: string) {
  const name = text.trim();
  if (!name) return;
  if (COMMON_LABELS.some((t) => t.toLowerCase() === name.toLowerCase())) {
    say(`"${name}" is already a common label`);
    return;
  }
  if (myLabels.some((t) => t.toLowerCase() === name.toLowerCase())) {
    say(`"${name}" is already in My labels`);
    return;
  }
  myLabels = [...myLabels, name].sort((a, b) => a.localeCompare(b));
  saveList(MY_LABELS_KEY, myLabels);
  openGroups.add("My labels");
  drawLabelGroups();
  say(`Saved "${name}" to My labels`);
}

function updateLabelCount() {
  $("my-label-count").textContent = myLabels.length ? `(${myLabels.length})` : "(none yet)";
  ($("btn-export-labels") as HTMLButtonElement).disabled = myLabels.length === 0;
}

$("btn-export-labels").addEventListener("click", () => {
  download(exportLabels(myLabels), "my-labels.json");
  say(`Exported ${myLabels.length} label${myLabels.length === 1 ? "" : "s"}`);
});
const importLabelsFile = $<HTMLInputElement>("import-labels-file");
$("btn-import-labels").addEventListener("click", () => importLabelsFile.click());
importLabelsFile.addEventListener("change", async () => {
  const file = importLabelsFile.files?.[0];
  importLabelsFile.value = "";
  if (!file) return;
  try {
    const builtIn = new Set(COMMON_LABELS.map((x) => x.toLowerCase()));
    const r = mergeLabels(myLabels, parseLabelsFile(await file.text()).filter((n) => !builtIn.has(n.toLowerCase())));
    myLabels = r.labels;
    saveList(MY_LABELS_KEY, myLabels);
    openGroups.add("My labels");
    drawLabelGroups();
    say(r.added ? `Added ${r.added} label${r.added === 1 ? "" : "s"} to My labels` : "No new labels in that file");
  } catch (err) {
    say(err instanceof Error ? err.message : "Couldn't read that file");
  }
});

const unitsSelect = $<HTMLSelectElement>("units");
unitsSelect.value = lengthStyle();
unitsSelect.addEventListener("change", () => {
  const u = unitsSelect.value as LengthStyle;
  setLengthStyle(u);
  try {
    localStorage.setItem(UNITS_KEY, u);
  } catch {
    /* storage unavailable */
  }
  redraw();
  say(u === "decimal" ? "Lengths in decimal feet (walls you already typed stay as typed)" : "Lengths in feet-inches (walls you already typed stay as typed)");
});

const snapSelect = $<HTMLSelectElement>("snap");
snapSelect.value = snapMode;
snapSelect.addEventListener("change", () => {
  snapMode = snapSelect.value as SnapMode;
  try {
    localStorage.setItem(SNAP_KEY, snapMode);
  } catch {
    /* storage unavailable */
  }
});

// Close the settings menu when clicking elsewhere.
document.addEventListener("pointerdown", (e) => {
  const st = $<HTMLDetailsElement>("settings");
  if (st.open && !st.contains(e.target as Node)) st.open = false;
});

function forgetLabel(name: string) {
  myLabels = myLabels.filter((t) => t !== name);
  saveList(MY_LABELS_KEY, myLabels);
  drawLabelGroups();
  say(`Removed "${name}" from My labels`);
}

function selectText(id: string | null) {
  selectedText = id;
  drawLabels();
  drawCanvas();
}

function drawLabels() {
  const texts = store.state.sketch.texts ?? [];
  if (selectedText && !texts.some((t) => t.id === selectedText)) selectedText = null;
  const t = texts.find((x) => x.id === selectedText);
  $("label-edit").classList.toggle("hidden", !t);
  if (t) sync(labelText, t.text);
}

/** Put a label on the sketch: in the selected area if it has walls, else the middle of the view. */
function addText(text: string) {
  const name = text.trim();
  if (!name) return;
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === store.state.selection?.area);
  const { width, height } = size();
  const base = ar && flatten(ar.shape.path).length >= 3 ? centroid(flatten(ar.shape.path)) : toWorld(view, { x: width / 2, y: height / 2 });
  // Stagger labels dropped on the same spot so they don't stack.
  const near = (store.state.sketch.texts ?? []).filter((t) => Math.hypot(t.at.x - base.x, t.at.y - base.y - 0) < 20).length;
  const inch = (v: number) => Math.round(v * 12) / 12;
  const at = { x: inch(base.x), y: inch(base.y - 2 - (near % 6) * 1.5) };
  const id = newId("t");
  store.update((draft) => {
    (draft.texts ??= []).push({ id, text: name, at });
  });
  selectText(id);
  canvas.focus();
}

function deleteText() {
  const id = selectedText;
  if (!id) return;
  store.update((draft) => {
    draft.texts = (draft.texts ?? []).filter((t) => t.id !== id);
  });
  selectText(null);
  say("Label deleted (Ctrl+Z to undo)");
}

labelGroups.addEventListener("click", (e) => {
  const forget = (e.target as Element).closest("[data-forget]");
  if (forget) {
    forgetLabel(forget.getAttribute("data-forget")!);
    return;
  }
  const b = (e.target as Element).closest("[data-label-text]");
  if (b) addText(b.getAttribute("data-label-text")!);
});
$("btn-save-label").addEventListener("click", () => {
  keepLabel(labelCustom.value);
  addText(labelCustom.value);
  labelCustom.value = "";
});
$("btn-keep-label").addEventListener("click", () => {
  const t = (store.state.sketch.texts ?? []).find((x) => x.id === selectedText);
  if (t) keepLabel(t.text);
});
$("btn-add-label").addEventListener("click", () => {
  addText(labelCustom.value);
  labelCustom.value = "";
});
labelCustom.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addText(labelCustom.value);
    labelCustom.value = "";
  }
});
labelText.addEventListener("input", () => {
  const id = selectedText;
  if (!id) return;
  store.update(
    (draft) => {
      const t = (draft.texts ?? []).find((x) => x.id === id);
      if (t) t.text = labelText.value;
    },
    { coalesce: `text-edit-${id}` },
  );
});
$("btn-delete-label").addEventListener("click", deleteText);

// ---------- print and PNG ----------

function printSketch() {
  $("print-root").innerHTML = printPageHtml(result, fittedScale());
  const img = $("print-root").querySelector("img");
  const go = () => window.print();
  if (img && !img.complete) img.addEventListener("load", go, { once: true });
  else go();
}
$("btn-print").addEventListener("click", printSketch);

function exportName(ext: string): string {
  const m = store.state.sketch.meta;
  const base = (files.name?.replace(/\.sketch\.json$|\.json$/i, "") || m.fileNumber || m.subject || "sketch").replace(/[^\w .-]+/g, "_").trim();
  return `${base || "sketch"}.${ext}`;
}

$("btn-png").addEventListener("click", async () => {
  try {
    const blob = await sketchPng(result, 1600, 1200, fittedScale());
    download(blob, exportName("png"));
    say("PNG downloaded");
  } catch {
    say("Could not make the PNG");
  }
});

$("btn-report").addEventListener("click", async () => {
  if (!result.structures.some((s) => s.areas.length > 0)) {
    say("Nothing to export yet");
    return;
  }
  try {
    const saved = await files.saveCompanion(reportExportJson(result, fittedScale()), exportName("areas.json"), "Sketch areas for a report", ".areas.json");
    if (saved) say(`Saved ${saved} for the report`);
  } catch {
    say("Could not save the report file");
  }
});

// ---------- area table ----------

const table = $<HTMLDivElement>("table");

function drawTable() {
  const blocks: string[] = [];
  if (result.nonAnsi) {
    blocks.push(`<div class="nonansi">${result.sketch.meta.ansi ? "Contains non-ANSI overrides" : "ANSI rules off"}</div>`);
  }
  for (const s of result.structures) {
    if (s.areas.length === 0) continue;
    const rows: string[] = [];
    for (const g of totalGroups(s)) {
      const single = g.rows.length === 1 && g.rows[0]!.label === g.name;
      if (!single) rows.push(`<tr class="group"><td colspan="2">${esc(g.name)}</td></tr>`);
      for (const r of g.rows) {
        rows.push(`<tr class="${r.bucket === "gla" ? "gla" : ""}${single ? "" : " in-group"}"><td>${esc(r.label)}</td><td class="num">${r.sf.toLocaleString("en-US")} sf</td></tr>`);
      }
      for (const l of g.levels) {
        rows.push(`<tr class="sub"><td>${esc(levelName(l.level))}</td><td class="num">${l.sf.toLocaleString("en-US")} sf</td></tr>`);
      }
    }
    if (rows.length === 0) rows.push(`<tr><td class="note" colspan="2">No areas yet</td></tr>`);
    const problems = s.areas.flatMap((a) => a.problems.map((p) => `${a.area.name}: ${p}`));
    blocks.push(
      `<table><tr><th colspan="2">${esc(s.structure.name)}</th></tr>${rows.join("")}</table>` +
        (s.overrides.length ? `<div class="note">Overrides: ${s.overrides.map((o) => esc(`${o.area} — ${o.note || "(no reason)"}`)).join("; ")}</div>` : "") +
        (problems.length ? `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""),
    );
  }
  blocks.push(`<div class="note">Totals are rounded to whole square feet after adding (ANSI Z765).</div>`);
  table.innerHTML = blocks.join("");
}

// ---------- toolbar ----------

const toast = $<HTMLDivElement>("toast");
let toastTimer = 0;
function say(msg: string) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function drawToolbar() {
  $<HTMLButtonElement>("btn-undo").disabled = !store.canUndo;
  $<HTMLButtonElement>("btn-redo").disabled = !store.canRedo;
  syncCheck($<HTMLInputElement>("show-dims"), store.state.sketch.meta.showDims !== false);
  syncCheck($<HTMLInputElement>("show-labels"), store.state.sketch.meta.showLabels !== false);
  const ansi = $<HTMLInputElement>("ansi-mode");
  if (ansi.checked !== store.state.sketch.meta.ansi) ansi.checked = store.state.sketch.meta.ansi;
  const dirty = store.revision !== savedRevision;
  $("file-status").textContent = `${files.name ?? "Unsaved sketch"}${dirty ? " •" : ""}`;
  document.title = `${dirty ? "• " : ""}${files.name ? `${files.name} – Appraiser Sketch` : "Appraiser Sketch"}`;
}

/** Ids of the room labels inside an area's outline (for moving them with it). */
function textsInside(sel: Selection): string[] {
  if (sel.stair || sel.zone) return [];
  const ar = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === sel.area);
  if (!ar) return [];
  const poly = flatten(ar.shape.path);
  if (poly.length < 3) return [];
  return (store.state.sketch.texts ?? []).filter((t) => containsPoint(poly, t.at)).map((t) => t.id);
}

function nextFreeOrigin(): Point {
  const b = sketchBounds();
  return b ? { x: Math.ceil(b.maxX) + 6, y: Math.floor(b.minY) } : { x: 0, y: 0 };
}

// ---------- add-area menu ----------

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];

interface AreaPreset {
  id: string;
  label: string;
  hint?: string;
  make(s: Structure): Partial<Area>;
}

const AREA_PRESETS: (AreaPreset | "sep")[] = [
  {
    id: "floor",
    label: "Living floor",
    hint: "next level up, finished",
    make: (s) => {
      const levels = s.areas.filter((a) => a.kind === "living" && a.grade === "above").map((a) => Number(a.level)).filter(Number.isFinite);
      const level = levels.length ? Math.max(...levels) + 1 : 1;
      return { name: `${ORDINALS[level - 1] ?? `Level ${level}`} floor`, level: String(level) };
    },
  },
  {
    id: "basement",
    label: "Basement (unfinished)",
    hint: "below grade, unfinished",
    make: () => ({ name: "Basement", level: "basement", grade: "below", finished: false }),
  },
  {
    id: "basement-fin",
    label: "Finished basement area",
    hint: "below grade, finished",
    make: () => ({ name: "Finished basement", level: "basement", grade: "below", finished: true }),
  },
  {
    id: "lower-level",
    label: "Lower level (walkout / split-level)",
    hint: "partly below grade, finished",
    make: () => ({ name: "Lower level", level: "lower", grade: "partial", finished: true }),
  },
  {
    id: "attic",
    label: "Finished attic",
    hint: "above grade; add low-ceiling zones",
    make: () => ({ name: "Attic", level: "attic" }),
  },
  "sep",
  { id: "garage", label: "Garage", make: () => ({ name: "Garage", kind: "garage" }) },
  { id: "carport", label: "Carport", make: () => ({ name: "Carport", kind: "carport" }) },
  { id: "porch", label: "Porch", make: () => ({ name: "Porch", kind: "porch" }) },
  { id: "deck", label: "Deck", make: () => ({ name: "Deck", kind: "deck" }) },
  { id: "patio", label: "Patio", make: () => ({ name: "Patio", kind: "patio" }) },
  { id: "breezeway", label: "Breezeway", make: () => ({ name: "Breezeway", kind: "breezeway" }) },
  { id: "other", label: "Other", make: () => ({ name: "Other", kind: "other" }) },
];

$("add-area-list").innerHTML = AREA_PRESETS.map((p) =>
  p === "sep" ? "<hr />" : `<button data-preset="${p.id}">${esc(p.label)}${p.hint ? `<small>${esc(p.hint)}</small>` : ""}</button>`,
).join("");

$("add-area-list").addEventListener("click", (e) => {
  const id = (e.target as Element).closest("[data-preset]")?.getAttribute("data-preset");
  const preset = AREA_PRESETS.find((p): p is AreaPreset => p !== "sep" && p.id === id);
  if (!preset) return;
  $<HTMLDetailsElement>("add-area").open = false;
  const sel = store.state.selection;
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel?.structure) ?? draft.structures[0];
    if (!s) return null;
    const a = newArea({ origin, ...preset.make(s) });
    s.areas.push(a);
    return { structure: s.id, area: a.id };
  });
  vectors.focus();
  vectors.setSelectionRange(vectors.value.length, vectors.value.length);
});

/**
 * A drop-down menu made from <details>. The sidebar scrolls (and clips), so
 * the menu is placed on the page under its button; it closes on an outside
 * click. `fill` runs as it opens, to build items that depend on the sketch.
 */
function dropMenu(detailsId: string, bodyId: string, fill?: () => void) {
  const m = $<HTMLDetailsElement>(detailsId);
  m.addEventListener("toggle", () => {
    if (!m.open) return;
    fill?.();
    const r = m.querySelector("summary")!.getBoundingClientRect();
    const body = $(bodyId);
    const w = Math.max(body.offsetWidth, 220);
    body.style.left = `${Math.round(Math.min(r.left, window.innerWidth - w - 8))}px`;
    body.style.top = `${Math.round(r.bottom + 4)}px`;
  });
  document.addEventListener("pointerdown", (e) => {
    if (m.open && !m.contains(e.target as Node)) m.open = false;
  });
}
dropMenu("add-area", "add-area-list");

// ---------- copy an area ----------

dropMenu("copy-area", "copy-area-list", () => {
  $("copy-area-list").innerHTML =
    `<button data-copy="exact">Exact copy<small>same settings; rename it after</small></button><hr />` +
    AREA_PRESETS.map((p) =>
      p === "sep" ? "<hr />" : `<button data-copy="${p.id}">As ${esc(p.label.replace(/ \(.*\)$/, "").toLowerCase())}</button>`,
    ).join("");
});

$("copy-area-list").addEventListener("click", (e) => {
  const id = (e.target as Element).closest("[data-copy]")?.getAttribute("data-copy");
  if (id) copySelectedArea(id);
});

/** Copy the selected area: "exact", or as one of the presets (next floor, basement, garage…). */
function copySelectedArea(id: string) {
  const sel = store.state.selection;
  const f = findArea(store.state.sketch, sel);
  if (!sel || !f) return;
  $<HTMLDetailsElement>("copy-area").open = false;
  const preset = AREA_PRESETS.find((p): p is AreaPreset => p !== "sep" && p.id === id);
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const found = findArea(draft, sel);
    if (!found) return null;
    // A preset sets the type, level and name; the copied outline is kept.
    const over: Partial<Area> = preset ? preset.make(found.structure) : {};
    delete over.vectors;
    const a = copyArea(found.area, origin, newId, over);
    found.structure.areas.push(a);
    return { structure: found.structure.id, area: a.id };
  });
  setCollapsed(props.panel, false);
  props.name.focus();
  props.name.select();
  say("Copied: set its name, type and level, then edit the walls if they differ");
}

// ---------- start an area from another's walls ----------

dropMenu("copy-walls", "copy-walls-list", () => {
  const sel = store.state.selection;
  const items: string[] = [];
  for (const s of store.state.sketch.structures) {
    for (const a of s.areas) {
      if (a.id === sel?.area || a.vectors.trim() === "") continue;
      const sf = result.structures.flatMap((x) => x.areas).find((x) => x.area.id === a.id)?.shape.area ?? 0;
      items.push(`<button data-walls-from="${esc(a.id)}">${esc(a.name)}<small>${esc(s.name)} · ${formatSqFt(sf)} sf</small></button>`);
    }
  }
  $("copy-walls-list").innerHTML = items.join("") || `<small class="muted" style="padding:4px 8px">No other area has walls yet</small>`;
});

$("copy-walls-list").addEventListener("click", (e) => {
  const fromId = (e.target as Element).closest("[data-walls-from]")?.getAttribute("data-walls-from");
  const sel = store.state.selection;
  if (!fromId || !sel) return;
  $<HTMLDetailsElement>("copy-walls").open = false;
  const src = store.state.sketch.structures.flatMap((s) => s.areas).find((a) => a.id === fromId);
  if (!src) return;
  editArea((a) => {
    a.vectors = src.vectors;
    delete a.hiddenDims;
  });
  say(`Walls copied from ${src.name} — edit any that differ`);
});

// ---------- copy a stair ----------

dropMenu("copy-stair", "copy-stair-list", () => {
  const sel = store.state.selection;
  const items: string[] = [`<button data-stair-to="">This area<small>a second stair beside it</small></button>`];
  for (const s of store.state.sketch.structures) {
    for (const a of s.areas) {
      if (a.id === sel?.area || a.kind !== "living") continue;
      items.push(`<button data-stair-to="${esc(a.id)}">${esc(a.name)}<small>${esc(s.name)} · ${esc(levelName(a.level))}</small></button>`);
    }
  }
  if (items.length === 1) items.push(`<small class="muted" style="padding:4px 8px">Add another floor to copy the stair there</small>`);
  $("copy-stair-list").innerHTML = items.join("");
});

$("copy-stair-list").addEventListener("click", (e) => {
  const b = (e.target as Element).closest("[data-stair-to]");
  const sel = store.state.selection;
  if (!b || !sel?.stair) return;
  $<HTMLDetailsElement>("copy-stair").open = false;
  const toId = b.getAttribute("data-stair-to") || sel.area;
  let target: Selection | null = null;
  store.update((draft) => {
    const from = findArea(draft, sel);
    const st = from && (from.area.stairs ?? []).find((x) => x.id === sel.stair);
    const to = draft.structures.flatMap((s) => s.areas.map((a) => ({ s, a }))).find((x) => x.a.id === toId);
    if (!from || !st || !to) return null;
    const copy = copyStairTo(st, from.area, to.a, newId("st"));
    if (to.a.id === from.area.id) {
      // Beside the original, along its width.
      const rad = (st.rotation * Math.PI) / 180;
      // Step across by the stair's whole footprint (an L or U is wider than one flight).
      const along = stairDrawing(st).parts.flat().map((q) => (q.x - st.origin.x) * Math.cos(rad) + (q.y - st.origin.y) * Math.sin(rad));
      const gap = Math.max(...along) - Math.min(0, ...along) + 1;
      copy.origin = { x: st.origin.x + gap * Math.cos(rad), y: st.origin.y + gap * Math.sin(rad) };
    }
    (to.a.stairs ??= []).push(copy);
    target = { structure: to.s.id, area: to.a.id, stair: copy.id };
    return target;
  });
  const t = target as Selection | null;
  if (t) {
    const name = findArea(store.state.sketch, t)?.area.name ?? "";
    say(t.area === sel.area ? "Stair copied" : `Stair copied to ${name} — drag it if the floors aren't drawn from the same corner`);
  }
});

$("btn-add-structure").addEventListener("click", () => {
  const origin = nextFreeOrigin();
  store.update((draft) => {
    const a = newArea({ name: "First floor", origin });
    const name = defaultStructureName("outbuilding", draft.structures.map((x) => x.name));
    const s = newStructure({ name, kind: "outbuilding", areas: [a] });
    draft.structures.push(s);
    return { structure: s.id, area: a.id };
  });
  // Pick the type first; the name follows it until you type your own.
  setCollapsed(sprops.panel, false);
  sprops.kind.focus();
});

$("btn-delete-area").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel) return;
  store.update((draft) => {
    const s = draft.structures.find((x) => x.id === sel.structure);
    if (!s) return null;
    const i = s.areas.findIndex((a) => a.id === sel.area);
    s.areas.splice(i, 1);
    const next = s.areas[Math.min(i, s.areas.length - 1)];
    return next ? { structure: s.id, area: next.id } : null;
  });
  say("Area deleted (Ctrl+Z to undo)");
});

$("btn-delete-structure").addEventListener("click", () => {
  const sel = store.state.selection;
  if (!sel) return;
  store.update((draft) => {
    draft.structures = draft.structures.filter((s) => s.id !== sel.structure);
    const s = draft.structures[0];
    const a = s?.areas[0];
    return s && a ? { structure: s.id, area: a.id } : null;
  });
  say("Structure deleted (Ctrl+Z to undo)");
});

$<HTMLInputElement>("show-dims").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    if (on) delete draft.meta.showDims;
    else draft.meta.showDims = false;
  });
});
$<HTMLInputElement>("show-labels").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    if (on) delete draft.meta.showLabels;
    else draft.meta.showLabels = false;
  });
});

$<HTMLInputElement>("ansi-mode").addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  store.update((draft) => {
    draft.meta.ansi = on;
  });
});

function confirmDiscard(): boolean {
  // An in-page check, not a browser dialog: a second click within 4 s confirms.
  if (store.revision === savedRevision) return true;
  const now = Date.now();
  if (now - lastDiscardWarn < 4000) return true;
  lastDiscardWarn = now;
  say("Unsaved changes — click again to discard them");
  return false;
}
let lastDiscardWarn = 0;

function loadSketch(sk: ReturnType<typeof newSketch>) {
  external = true;
  store.load(sk);
  savedRevision = store.revision;
  fit();
}

$("btn-new").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  files.reset();
  loadSketch(newSketch());
  vectors.focus();
});

async function doOpen() {
  if (!confirmDiscard()) return;
  try {
    const sk = await files.open();
    if (sk) {
      loadSketch(sk);
      say(`Opened ${files.name}`);
    }
  } catch (e) {
    say(e instanceof SketchFileError ? e.message : "Could not open the file");
  }
}

async function doSave(saveAs: boolean) {
  // Note what is being written before waiting on the dialog and the disk:
  // a change made meanwhile is not in the file and must still count as unsaved.
  const revision = store.revision;
  try {
    if (await files.save(store.state.sketch, saveAs)) {
      savedRevision = revision;
      drawToolbar();
      say(`Saved ${files.name}`);
    }
  } catch {
    say("Could not save the file");
  }
}

$("btn-open").addEventListener("click", () => void doOpen());
$("btn-save").addEventListener("click", () => void doSave(false));
$("btn-save-as").addEventListener("click", () => void doSave(true));
$("btn-undo").addEventListener("click", () => undo());
$("btn-redo").addEventListener("click", () => redo());
$("btn-fit").addEventListener("click", () => {
  setAutoFit(true);
  fit();
});

$("btn-copy").addEventListener("click", async () => {
  const text = totalsText(result);
  try {
    await navigator.clipboard.writeText(text);
    say("Totals copied");
  } catch {
    say("Clipboard not available");
  }
});

function undo() {
  external = true;
  store.undo();
}
function redo() {
  external = true;
  store.redo();
}

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (e.key === "Escape" && drawing) {
    e.preventDefault();
    finishDrawingWalls();
    canvas.focus();
  } else if (mod && k === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (mod && k === "s") {
    e.preventDefault();
    void doSave(e.shiftKey);
  } else if (mod && k === "p") {
    e.preventDefault();
    printSketch();
  } else if (mod && k === "o") {
    e.preventDefault();
    void doOpen();
  } else if (!mod && k === "f" && document.activeElement === canvas) {
    setAutoFit(true);
    fit();
  } else if (!mod && !e.altKey && k === "t" && document.activeElement === canvas && store.state.selection?.stair) {
    rotateStair();
  } else if (!mod && !e.altKey && document.activeElement === canvas && e.key in ARROWS && cornerToNudge()) {
    // A picked corner: arrows move it 1", Shift+arrow 1'.
    e.preventDefault();
    nudgeCorner(ARROWS[e.key]!, e.shiftKey ? 1 : smallStep());
  } else if (!mod && !e.altKey && document.activeElement === canvas && e.key === "Enter" && endAdjust()) {
    e.preventDefault();
  } else if (!mod && document.activeElement === canvas && e.key === "Enter" && drawing) {
    e.preventDefault();
    finishDrawingWalls();
  } else if (!mod && document.activeElement === canvas && e.key === "Delete" && !picked && !selectedText && store.state.selection?.iwall) {
    e.preventDefault();
    deleteInteriorWall();
  } else if (!mod && !e.altKey && document.activeElement === canvas && e.key in ARROWS) {
    if (arrowIntoWalls(e.key, true, e.shiftKey)) {
      e.preventDefault();
      vectors.focus();
    }
  } else if (!mod && document.activeElement === canvas && picked && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    hidePicked();
  } else if (!mod && !e.altKey && k === "c" && document.activeElement === canvas) {
    // C toggles Auto fit (on the drawing; in the walls box it types as usual).
    setAutoFit(!autoFit);
    if (autoFit) fit();
    say(autoFit ? "Auto fit on" : "Auto fit off");
  } else if (!mod && document.activeElement === canvas && selectedText && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    deleteText();
  } else if (!mod && !e.altKey && document.activeElement === canvas && e.key === "Backspace") {
    e.preventDefault();
    deleteWallAction();
  } else if (!mod && !e.altKey && document.activeElement === canvas && k === "a" && closeKeyIntoWalls(true)) {
    e.preventDefault();
    vectors.focus();
  } else if (!mod && !e.altKey && e.key.length === 1 && document.activeElement === canvas && k !== "f" && k !== "c") {
    // Typing on the drawing goes into the walls box, as in other sketch programs.
    e.preventDefault();
    typeIntoWalls(e.key);
  }
});

// Warn before closing with unsaved changes (not in development, where the
// dev server reloads the page on every code change; the draft covers that).
if (!import.meta.env.DEV) {
  window.addEventListener("beforeunload", (e) => {
    if (store.revision !== savedRevision) e.preventDefault();
  });
}

const anglesToggle = $<HTMLInputElement>("show-angles");
anglesToggle.checked = showAngles;
anglesToggle.addEventListener("change", () => {
  showAngles = anglesToggle.checked;
  try {
    localStorage.setItem("sketch:angles", showAngles ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  drawCanvas();
});

const gridToggle = $<HTMLInputElement>("show-grid");
gridToggle.checked = showGrid;
autoFitToggle.addEventListener("change", () => {
  setAutoFit(autoFitToggle.checked);
  if (autoFit) fit();
});

gridToggle.addEventListener("change", () => {
  showGrid = gridToggle.checked;
  try {
    localStorage.setItem("sketch:grid", showGrid ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
  drawCanvas();
});

// ---------- theme (a per-viewer preference, kept in this browser only) ----------

const themeSelect = $<HTMLSelectElement>("theme");
themeSelect.value = document.documentElement.dataset.theme ?? "auto";
themeSelect.addEventListener("change", () => {
  const t = themeSelect.value;
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("sketch:theme", t);
  } catch {
    /* storage unavailable; the choice lasts for this visit */
  }
  drawCanvas();
});

// ---------- where the walls box sits (a per-viewer preference, kept in this browser only) ----------

const DOCKS = ["bottom", "top", "left", "right", "float"] as const;
type Dock = (typeof DOCKS)[number];
const DOCK_KEY = "sketch:walls-dock";
const FLOAT_KEY = "sketch:walls-float";
const work = document.querySelector<HTMLElement>(".work")!;
const vectorBar = document.querySelector<HTMLElement>(".vector-bar")!;
const dockSelect = $<HTMLSelectElement>("walls-dock");

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable; the choice lasts for this visit */
  }
}

/** Put the floating box at (x, y) inside the work area, kept fully in view. */
function placeFloat(x: number, y: number) {
  const maxX = Math.max(0, work.clientWidth - vectorBar.offsetWidth);
  const maxY = Math.max(0, work.clientHeight - vectorBar.offsetHeight);
  vectorBar.style.left = `${Math.min(maxX, Math.max(0, x))}px`;
  vectorBar.style.top = `${Math.min(maxY, Math.max(0, y))}px`;
}

function setDock(dock: Dock) {
  work.dataset.dock = dock;
  dockSelect.value = dock;
  vectorBar.style.left = "";
  vectorBar.style.top = "";
  if (dock === "float") {
    let at = { x: 12, y: 12 };
    try {
      const saved = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? "null");
      if (saved && typeof saved.x === "number" && typeof saved.y === "number") at = saved;
    } catch {
      /* no saved place */
    }
    placeFloat(at.x, at.y);
  }
}

dockSelect.addEventListener("change", () => {
  const dock = DOCKS.find((d) => d === dockSelect.value) ?? "bottom";
  setDock(dock);
  remember(DOCK_KEY, dock);
});

// Floating: drag the box by the word "Walls".
vectorLabel.addEventListener("pointerdown", (e) => {
  if (work.dataset.dock !== "float" || e.button !== 0) return;
  e.preventDefault();
  const from = { x: e.clientX - vectorBar.offsetLeft, y: e.clientY - vectorBar.offsetTop };
  vectorLabel.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => placeFloat(ev.clientX - from.x, ev.clientY - from.y);
  const done = () => {
    vectorLabel.removeEventListener("pointermove", move);
    vectorLabel.removeEventListener("pointerup", done);
    vectorLabel.removeEventListener("pointercancel", done);
    remember(FLOAT_KEY, JSON.stringify({ x: vectorBar.offsetLeft, y: vectorBar.offsetTop }));
  };
  vectorLabel.addEventListener("pointermove", move);
  vectorLabel.addEventListener("pointerup", done);
  vectorLabel.addEventListener("pointercancel", done);
});

{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(DOCK_KEY);
  } catch {
    /* storage unavailable */
  }
  setDock(DOCKS.find((d) => d === saved) ?? "bottom");
}

// ---------- right-click menus ----------

type MenuItem = { label: string; hint?: string; danger?: boolean; run?: () => void; sub?: () => MenuItem[] } | "sep";
const ctxMenu = document.createElement("div");
ctxMenu.className = "add-menu-body ctx-menu hidden";
ctxMenu.setAttribute("role", "menu");
document.body.append(ctxMenu);
let ctxItems: MenuItem[] = [];
let ctxAt = { x: 0, y: 0 };

function closeMenu() {
  ctxMenu.classList.add("hidden");
}

function openMenu(x: number, y: number, items: MenuItem[]) {
  ctxItems = items;
  ctxAt = { x, y };
  ctxMenu.innerHTML = items
    .map((it, k) =>
      it === "sep"
        ? "<hr />"
        : `<button role="menuitem" data-item="${k}"${it.danger ? ' class="danger"' : ""}>${esc(it.label)}${it.sub ? '<span class="more">▸</span>' : ""}${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</button>`,
    )
    .join("");
  ctxMenu.classList.remove("hidden");
  // Keep the whole menu on screen.
  const w = ctxMenu.offsetWidth;
  const h = ctxMenu.offsetHeight;
  ctxMenu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - w - 4))}px`;
  ctxMenu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - h - 4))}px`;
}

ctxMenu.addEventListener("click", (e) => {
  const k = (e.target as Element).closest("[data-item]")?.getAttribute("data-item");
  const it = k === null || k === undefined ? undefined : ctxItems[Number(k)];
  if (it && it !== "sep" && it.sub) {
    openMenu(ctxAt.x, ctxAt.y, it.sub()); // the choices take the menu's place
    return;
  }
  closeMenu();
  if (it && it !== "sep") it.run?.();
});

/** A menu item that offers a drop-down's choices, ticking the current one; picking one sets it as the drop-down would. */
function choiceItem(label: string, select: HTMLSelectElement): MenuItem[] {
  if (select.disabled || select.closest(".hidden")) return [];
  const current = select.selectedOptions[0]?.textContent ?? "";
  return [
    {
      label,
      hint: current,
      sub: () =>
        [...select.options].map((o) => ({
          label: `${o.value === select.value ? "✓ " : "\u2003 "}${o.textContent ?? o.value}`,
          run: () => {
            select.value = o.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          },
        })),
    },
  ];
}

/** A menu item that flips a checkbox, showing how it stands now. */
function toggleItem(label: string, box: HTMLInputElement): MenuItem[] {
  if (box.disabled || box.closest(".hidden")) return [];
  return [
    {
      label: `${box.checked ? "✓ " : "\u2003 "}${label}`,
      run: () => {
        box.checked = !box.checked;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      },
    },
  ];
}
ctxMenu.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerdown", (e) => {
  if (!ctxMenu.contains(e.target as Node)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

/** Put the caret in a name box with its text selected, ready to type over. */
function renameIn(panel: Element, input: HTMLInputElement) {
  setCollapsed(panel, false);
  input.focus();
  input.select();
}

function areaMenu(): MenuItem[] {
  const f = findArea(store.state.sketch, store.state.selection);
  if (!f) return [];
  const r = result.structures.flatMap((s) => s.areas).find((a) => a.area.id === f.area.id);
  const walls = r?.shape.path.segments.length ?? 0;
  const open = walls > 0 && r !== undefined && !r.shape.closure.closed;
  const items: MenuItem[] = [
    { label: "Rename area", run: () => renameIn(props.panel, props.name) },
    ...choiceItem("Type", props.kind),
    { label: "Level", hint: `${f.area.level.trim() || "not set"} (a number, basement, attic…)`, run: () => renameIn(props.panel, props.level) },
    ...choiceItem("Grade", props.grade),
    ...choiceItem("Ceiling", props.ceiling),
    ...toggleItem("Finished", props.finished),
    ...toggleItem("Connected to finished space", props.connected),
    "sep",
    { label: "Duplicate", hint: "an exact copy beside it", run: () => copySelectedArea("exact") },
    "sep",
  ];
  if (open) items.push({ label: "Close outline", hint: "a straight wall back to the start", run: () => editArea((a) => (a.vectors = closeOutline(a.vectors))) });
  if (open) items.push({ label: "Delete last wall", run: () => void deleteWallAction() });
  else if (walls > 0) items.push({ label: "Open outline", hint: "removes the closing wall", run: () => void deleteWallAction() });
  items.push(
    { label: "Add stair", run: () => $("btn-add-stair").click() },
    ...(f.area.stairs ?? []).map((st, k): MenuItem => ({
      label: `Delete stair ${k + 1}`,
      hint: STAIR_TYPE_SHORT[st.type] ?? "",
      danger: true,
      run: () => {
        const sel = store.state.selection;
        if (!sel) return;
        store.select({ structure: sel.structure, area: sel.area, stair: st.id });
        $("btn-delete-stair").click();
      },
    })),
    { label: "Add ceiling zone or opening", run: () => $("btn-show-zones").click() },
    { label: "Draw interior walls", run: () => iwallButton.click() },
    "sep",
    { label: "Fit to window", run: () => { setAutoFit(true); fit(); } },
    "sep",
    { label: "Delete area", danger: true, run: () => $("btn-delete-area").click() },
  );
  return items;
}

function stairMenu(): MenuItem[] {
  const st = selectedStair();
  if (!st) return areaMenu();
  return [
    ...choiceItem("Stair type", stairs.type),
    ...(st.type === "steps" ? [{ label: "Edit its steps", hint: (st.plan ?? "").trim() || "none yet", run: () => renameIn(stairs.panel, stairs.plan as unknown as HTMLInputElement) }] : []),
    ...choiceItem("Arrow", stairs.dir),
    ...(st.type === "straight" || st.type === "landing" || st.type === "steps" ? [] : choiceItem("Turn", stairs.turn)),
    { label: "Rotate 90°", run: () => rotateStair() },
    { label: "Copy to…", hint: "this or another floor", run: () => { setCollapsed(stairs.panel, false); const d = $<HTMLDetailsElement>("copy-stair"); d.open = true; d.querySelector("summary")?.focus(); } },
    "sep",
    { label: "Delete stair", danger: true, run: () => $("btn-delete-stair").click() },
  ];
}

function structureMenu(): MenuItem[] {
  return [
    { label: "Rename structure", run: () => renameIn(sprops.panel, sprops.name) },
    ...choiceItem("Type", sprops.kind),
    { label: "Add area…", run: () => { const d = $<HTMLDetailsElement>("add-area"); d.open = true; d.querySelector("summary")?.focus(); } },
    "sep",
    { label: "Delete structure", danger: true, run: () => $("btn-delete-structure").click() },
  ];
}

function sketchMenu(): MenuItem[] {
  return [
    { label: "Fit to window", run: () => { setAutoFit(true); fit(); } },
    { label: "Undo", run: () => undo() },
    { label: "Redo", run: () => redo() },
    "sep",
    { label: "Add area…", run: () => { const d = $<HTMLDetailsElement>("add-area"); d.open = true; d.querySelector("summary")?.focus(); } },
  ];
}

// In the list of structures and areas: right-click selects, then offers what can be done with it.
tree.addEventListener("contextmenu", (e) => {
  const el = (e.target as Element).closest("[data-structure]");
  if (!el) return;
  e.preventDefault();
  const structure = el.getAttribute("data-structure")!;
  const area = el.getAttribute("data-area");
  if (area) {
    store.select({ structure, area });
    openMenu(e.clientX, e.clientY, areaMenu());
    return;
  }
  const first = store.state.sketch.structures.find((x) => x.id === structure)?.areas[0];
  if (first && store.state.selection?.structure !== structure) store.select({ structure, area: first.id });
  openMenu(e.clientX, e.clientY, store.state.selection?.structure === structure ? structureMenu() : sketchMenu());
});

// A stair in the Stairs panel's list.
stairs.list.addEventListener("contextmenu", (e) => {
  const b = (e.target as Element).closest("[data-stair]");
  const sel = store.state.selection;
  if (!b || !sel) return;
  e.preventDefault();
  store.select({ structure: sel.structure, area: sel.area, stair: b.getAttribute("data-stair")! });
  openMenu(e.clientX, e.clientY, stairMenu());
});

// On the drawing: over a stair it is the stair's menu, over an area that area's, elsewhere the sketch's.
canvas.addEventListener("contextmenu", (e) => {
  if (drawing) return; // drawing interior walls: leave the mouse alone
  e.preventDefault();
  // The press may have started a pan that captures the pointer, so look under the pointer, not at the event's target.
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("#canvas [data-area]");
  const structure = el?.getAttribute("data-structure");
  const area = el?.getAttribute("data-area");
  const stair = el?.getAttribute("data-stair");
  if (structure && area && stair) {
    store.select({ structure, area, stair });
    openMenu(e.clientX, e.clientY, stairMenu());
  } else if (structure && area) {
    store.select({ structure, area });
    openMenu(e.clientX, e.clientY, areaMenu());
  } else {
    openMenu(e.clientX, e.clientY, sketchMenu());
  }
});

// ---------- wiring ----------

let draftTimer = 0;
function redraw() {
  result = computeSketch(store.state.sketch);
  if (drawing && store.state.selection?.area !== drawing.sel.area) {
    finishDrawingWalls();
    return; // finishing redraws
  }
  // Keep the whole sketch in view as walls are added (not mid-drag, which would make things jump).
  if (autoFit && !drag) fit();
  else drawCanvas();
  drawTree();
  drawProps();
  drawMeta();
  drawLabels();
  drawStairs();
  drawZones();
  drawVectorBar();
  drawTable();
  drawToolbar();
  external = false;
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => saveDraft(store.state.sketch), 400);
}

const SELECTION_KEY = "sketch:selection";
try {
  const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "null") as Selection | null;
  if (findArea(store.state.sketch, saved)) store.select(saved);
} catch {
  /* no saved selection */
}

store.subscribe(redraw);
// Save the draft at once when the page goes away, so a quick reload or close
// doesn't lose the last change (drafts are otherwise saved 0.4 s after edits).
window.addEventListener("pagehide", () => saveDraft(store.state.sketch));
store.subscribe((st) => {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(st.selection));
  } catch {
    /* storage unavailable */
  }
});
redraw();
requestAnimationFrame(() => fit());
if (draftWasRejected()) say("The last draft could not be read, so a blank sketch was started (a copy of the draft was kept)");

// Exposed for debugging and automated checks.
(window as unknown as { sketchApp: unknown }).sketchApp = { store, get result() { return result; }, printHtml: () => printPageHtml(result, fittedScale()) };
