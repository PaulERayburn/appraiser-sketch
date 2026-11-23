/**
 * Sketch → SVG markup. Pure: takes computed results and a view transform,
 * returns a string. Styling is by CSS class (see style.css) so it follows the theme.
 */

import { cornerAngles, formatAngle,
  arcGeometry,
  flatten,
  formatLength,
  formatSqFt,
  orientation,
  signedPolygonArea,
  doorSymbol,
  seatDoor,
  stairDrawing,
  wallSegments,
  stairHandles,
  zoneShort,
  type AreaResult,
  type Path,
  type Stair,
  type Point,
  type SketchResult,
} from "../geometry/index.js";
import type { Selection } from "./store.js";

/** Screen = (x·scale + ox, −y·scale + oy). Feet in, pixels out. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export const toScreen = (v: View, p: Point): Point => ({ x: p.x * v.scale + v.ox, y: -p.y * v.scale + v.oy });
export const toWorld = (v: View, p: Point): Point => ({ x: (p.x - v.ox) / v.scale, y: -(p.y - v.oy) / v.scale });

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (v: number) => v.toFixed(1);

/** Area-weighted centroid of a polygon; bounding-box center if degenerate. */
export function centroid(pts: Point[]): Point {
  const a = signedPolygonArea(pts);
  if (Math.abs(a) < 1e-9) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function gridMarkup(v: View, width: number, height: number): string {
  // Pick a step that keeps lines at least 10px apart: 1, 5, 10, 50 ft …
  const steps = [1, 5, 10, 50, 100];
  const minor = steps.find((s) => s * v.scale >= 18) ?? 100;
  const major = minor * (minor === 1 ? 5 : minor === 5 ? 2 : 5);
  const tl = toWorld(v, { x: 0, y: 0 });
  const br = toWorld(v, { x: width, y: height });
  const lines: string[] = [];
  for (let x = Math.floor(tl.x / minor) * minor; x <= br.x; x += minor) {
    const sx = x * v.scale + v.ox;
    lines.push(`<line class="${Math.round(x) % major === 0 ? "grid-major" : "grid"}" x1="${n(sx)}" y1="0" x2="${n(sx)}" y2="${height}"/>`);
  }
  for (let y = Math.floor(br.y / minor) * minor; y <= tl.y; y += minor) {
    const sy = -y * v.scale + v.oy;
    lines.push(`<line class="${Math.round(y) % major === 0 ? "grid-major" : "grid"}" x1="0" y1="${n(sy)}" x2="${width}" y2="${n(sy)}"/>`);
  }
  return `<g class="grid-layer">${lines.join("")}</g>`;
}

function dimensionLabels(r: AreaResult, v: View, pick: { data: string; picked: number | null } | null = null, ts = 1): string {
  const path = r.shape.path;
  if (path.segments.length === 0) return "";
  const orient = orientation(path);
  const out: string[] = [];
  const fontPx = 11 * ts;
  const hidden = new Set(r.area.hiddenDims ?? []);
  for (const [k, seg] of path.segments.entries()) {
    if (hidden.has(k)) continue;
    const a = toScreen(v, seg.from);
    const b = toScreen(v, seg.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 24 * ts) continue; // too short to label legibly
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    const wl = Math.hypot(dx, dy);
    // Outward normal in world space: right-hand for a CCW outline.
    const nx = (orient * dy) / wl;
    const ny = (-orient * dx) / wl;
    let mid = { x: (seg.from.x + seg.to.x) / 2, y: (seg.from.y + seg.to.y) / 2 };
    if (seg.kind === "arc") {
      const g = arcGeometry(seg, orient);
      const ang = g.startAngle + g.sweep / 2;
      mid = { x: g.center.x + g.radius * Math.cos(ang), y: g.center.y + g.radius * Math.sin(ang) };
    }
    const off = (9 * ts) / v.scale;
    const p = toScreen(v, { x: mid.x + nx * off, y: mid.y + ny * off });
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const text = formatLength(wl) + (seg.kind === "arc" ? ` ⌒${formatLength(Math.abs(seg.sagitta))}` : "");
    out.push(
      `<text class="dim${pick ? " pickable" : ""}${pick?.picked === k ? " picked" : ""}"${pick ? ` ${pick.data} data-dim="${k}"` : ""} font-size="${fontPx}" x="${n(p.x)}" y="${n(p.y)}" transform="rotate(${deg.toFixed(1)} ${n(p.x)} ${n(p.y)})">${esc(text)}</text>`,
    );
  }
  return out.join("");
}

/** "1,248.0 sf", or "512.0 sf (768.0 gross)" when ANSI counts less than the outline. */
export function areaSizeText(r: AreaResult): string {
  const gross = r.shape.area;
  const counted = r.ansi.counted;
  if (r.area.kind === "living" && Math.abs(gross - counted) > 0.05) return `${formatSqFt(counted)} sf (${formatSqFt(gross)} gross)`;
  return `${formatSqFt(gross)} sf`;
}

function stairMarkup(st: Stair, v: View, data: string, selected: boolean): string {
  const d = stairDrawing(st);
  const poly = (pts: Point[]) => `M${pts.map((p) => toScreen(v, p)).map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z`;
  const out: string[] = [];
  const cls = `stair${selected ? " selected" : ""}`;
  for (const part of d.parts) out.push(`<path class="${cls}" ${data} data-stair="${esc(st.id)}" d="${poly(part)}"/>`);
  for (const [a, b] of d.lines) {
    const p = toScreen(v, a);
    const q = toScreen(v, b);
    out.push(`<line class="tread" x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}"/>`);
  }
  const arrow = d.arrow.map((p) => toScreen(v, p));
  if (arrow.length >= 2) {
    out.push(`<polyline class="stair-arrow" points="${arrow.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}"/>`);
    // Arrowhead at the end, pointing along the last segment.
    const tip = arrow[arrow.length - 1]!;
    const prev = arrow[arrow.length - 2]!;
    const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const h = Math.max(5, Math.min(10, v.scale * 0.6));
    const l = { x: tip.x - h * Math.cos(ang - 0.45), y: tip.y - h * Math.sin(ang - 0.45) };
    const r = { x: tip.x - h * Math.cos(ang + 0.45), y: tip.y - h * Math.sin(ang + 0.45) };
    out.push(`<path class="stair-head" d="M${n(tip.x)},${n(tip.y)}L${n(l.x)},${n(l.y)}L${n(r.x)},${n(r.y)}Z"/>`);
    // UP / DN label just before the start of the walking line.
    const a0 = arrow[0]!;
    const a1 = arrow[1]!;
    const back = Math.atan2(a1.y - a0.y, a1.x - a0.x);
    const lp = { x: a0.x - 9 * Math.cos(back), y: a0.y - 9 * Math.sin(back) };
    out.push(`<text class="stair-label" x="${n(lp.x)}" y="${n(lp.y)}">${st.direction === "up" ? "UP" : "DN"}</text>`);
  }
  return out.join("");
}

export interface RenderOptions {
  width: number;
  height: number;
  view: View;
  selection: Selection | null;
  /** Draw the background grid (default true). */
  grid?: boolean;
  /** Draw interactive extras: start/pen marks, stair handles (default true; off for print). */
  interactive?: boolean;
  /** Corner of the selected area picked for editing. */
  activeCorner?: number | null;
  /** Selected room label id. */
  selectedText?: string | null;
  /** Show inside angles at the selected area's corners (screen only). */
  angles?: boolean;
  /** Text size and spacing multiplier (print matches the on-screen proportions). */
  textScale?: number;
  /** A dimension or area label picked for hiding with Delete. */
  picked?: { kind: "dim" | "label"; area: string; wall?: number } | null;
  /** Drawing an interior wall: where the next click would land, and the line to it from the last point. */
  preview?: { from: Point | null; to: Point; kind: string } | null;
}

/** An open run of walls as SVG path data (arcs flattened). */
function runPath(path: Path, v: View): string {
  const pts = flatten(path, Math.PI / 48).map((p) => toScreen(v, p));
  return pts.length >= 2 ? `M${pts.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}` : "";
}

/** Lengths beside each wall of a selected interior wall (screen only). */
function runLengths(path: Path, v: View): string {
  const out: string[] = [];
  for (const seg of path.segments) {
    const a = toScreen(v, seg.from);
    const b = toScreen(v, seg.to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 24) continue;
    // Beside the wall, on its left as drawn.
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const p = { x: (a.x + b.x) / 2 - nx * 9, y: (a.y + b.y) / 2 - ny * 9 };
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const wl = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
    out.push(`<text class="dim iwall-dim" font-size="11" x="${n(p.x)}" y="${n(p.y)}" transform="rotate(${deg.toFixed(1)} ${n(p.x)} ${n(p.y)})">${esc(formatLength(wl))}</text>`);
  }
  return out.join("");
}

/** Where an area's label sits: outline centre plus the saved offset. */
export function labelPoint(r: AreaResult): Point {
  const c = centroid(flatten(r.shape.path, Math.PI / 48));
  return { x: c.x + (r.area.label?.x ?? 0), y: c.y + (r.area.label?.y ?? 0) };
}

export function renderSketch(result: SketchResult, opts: RenderOptions): string {
  const { view: v, width, height, selection } = opts;
  const interactive = opts.interactive ?? true;
  const ts = opts.textScale ?? 1;
  const meta = result.sketch.meta;
  const parts: string[] = opts.grid === false ? [] : [gridMarkup(v, width, height)];
  const labels: string[] = [];
  const handles: string[] = [];
  /** Doors are clicked through the wall handles, so their hit lines go on top. */
  const doorHits: string[] = [];

  for (const s of result.structures) {
    for (const r of s.areas) {
      const pts = flatten(r.shape.path, Math.PI / 48);
      const selected = selection?.structure === s.structure.id && selection.area === r.area.id;
      const areaSelected = selected && !selection?.stair && !selection?.zone && !selection?.iwall && !selection?.door;
      const cls = ["area", `kind-${r.area.kind}`, `bucket-${r.ansi.bucket}`, areaSelected ? "selected" : "", r.problems.length ? "has-problems" : ""]
        .filter(Boolean)
        .join(" ");
      const data = `data-structure="${esc(s.structure.id)}" data-area="${esc(r.area.id)}"`;
      const scr = pts.map((p) => toScreen(v, p));

      if (pts.length >= 3) {
        const d = `M${scr.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z`;
        parts.push(`<path class="${cls}" ${data} d="${d}"/>`);
      } else if (pts.length === 2) {
        parts.push(`<path class="${cls}" ${data} d="M${n(scr[0]!.x)},${n(scr[0]!.y)}L${n(scr[1]!.x)},${n(scr[1]!.y)}"/>`);
      }

      // Zones (ceiling bands, openings) inside the area.
      for (const z of r.zones) {
        const wp = flatten(z.path);
        const zp = wp.map((p) => toScreen(v, p));
        if (zp.length >= 3) {
          const zsel = selected && selection?.zone === z.zone.id;
          // A sloped ceiling: shade its under-5' and 5'–7' parts under the zone's outline.
          for (const b of z.bands ?? []) {
            const bp = b.outline.map((p) => toScreen(v, p));
            parts.push(`<path class="zone-part zone-${b.band}" d="M${bp.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z"/>`);
          }
          parts.push(
            `<path class="zone zone-${z.zone.band}${zsel ? " selected" : ""}${z.inside ? "" : " outside"}" ${data} data-zone="${esc(z.zone.id)}" d="M${zp.map((p) => `${n(p.x)},${n(p.y)}`).join("L")}Z"/>`,
          );
          const c = toScreen(v, centroid(wp));
          const short = zoneShort(z.zone);
          labels.push(`<text class="zone-label" x="${n(c.x)}" y="${n(c.y)}">${esc(z.zone.name ? `${z.zone.name} · ${short}` : short)}</text>`);
        }
      }

      // Interior walls (floor plan only; they never change the area).
      for (const w of r.walls) {
        const d = runPath(w.path, v);
        if (!d) continue;
        const wsel = selected && selection?.iwall === w.wall.id;
        parts.push(`<path class="iwall${wsel ? " selected" : ""}${w.inside ? "" : " outside"}" d="${d}"/>`);
        if (!interactive) continue;
        parts.push(`<path class="iwall-hit" ${data} data-iwall="${esc(w.wall.id)}" d="${d}"><title>Interior wall: drag to move, click to edit</title></path>`);
        if (wsel) {
          labels.push(runLengths(w.path, v));
          const cs = [w.path.start, ...w.path.segments.map((sg) => sg.to)];
          const closed = cs.length > 2 && Math.hypot(cs[0]!.x - cs.at(-1)!.x, cs[0]!.y - cs.at(-1)!.y) < 1e-6;
          (closed ? cs.slice(0, -1) : cs).forEach((c, i) => {
            const p = toScreen(v, c);
            handles.push(
              `<circle class="corner" ${data} data-iwall="${esc(w.wall.id)}" data-iwall-corner="${i}" cx="${n(p.x)}" cy="${n(p.y)}" r="5"><title>Drag to move this end or bend</title></circle>`,
            );
          });
        }
      }

      // Stairs (symbols only; they never change the area).
      if (r.area.doors?.length) {
        // Doors sit in the walls as they are now, so one stays put when its wall is nudged.
        const walls = wallSegments([r.shape.path, ...r.walls.map((w) => w.path)]);
        for (const door of r.area.doors) {
          const sym = doorSymbol(seatDoor(door, walls));
          const a = toScreen(v, sym.a);
          const b = toScreen(v, sym.b);
          const on = selected && selection?.door === door.id;
          parts.push(`<line class="door-gap" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"/>`);
          for (const line of sym.lines) {
            const pts = line.map((p) => toScreen(v, p)).map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
            parts.push(`<polyline class="door-leaf${sym.dashed ? " dashed" : ""}${on ? " selected" : ""}" points="${pts}"/>`);
          }
          if (interactive) {
            doorHits.push(
              `<line class="door-hit${on ? " selected" : ""}" ${data} data-door="${esc(door.id)}" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"><title>Door: click to edit, right-click for more</title></line>`,
            );
          }
        }
      }
      for (const st of r.area.stairs ?? []) {
        const stairSelected = selected && selection?.stair === st.id;
        parts.push(stairMarkup(st, v, data, stairSelected));
        if (stairSelected && interactive) {
          for (const h of stairHandles(st)) {
            const p = toScreen(v, h.point);
            handles.push(
              `<circle class="handle handle-${h.key}" ${data} data-stair="${esc(st.id)}" data-handle="${h.key}" cx="${n(p.x)}" cy="${n(p.y)}" r="6"><title>Drag to resize</title></circle>`,
            );
          }
        }
      }

      // Open outline: show the implied closing wall and the pen position.
      if (!r.shape.closure.closed && r.shape.path.segments.length > 0) {
        const end = toScreen(v, r.shape.path.segments[r.shape.path.segments.length - 1]!.to);
        const start = toScreen(v, r.shape.path.start);
        parts.push(`<line class="misclosure" x1="${n(end.x)}" y1="${n(end.y)}" x2="${n(start.x)}" y2="${n(start.y)}"/>`);
      }
      if (areaSelected && interactive && r.shape.path.segments.length > 0) {
        const segs = r.shape.path.segments;
        const closed = r.shape.closure.closed;
        // Walls: grab one to slide it in or out, square to itself.
        segs.forEach((sg, k) => {
          const a = toScreen(v, sg.from);
          const b = toScreen(v, sg.to);
          const horiz = Math.abs(b.y - a.y) < 0.5;
          const vert = Math.abs(b.x - a.x) < 0.5;
          const cur = horiz ? "ns-resize" : vert ? "ew-resize" : "move";
          handles.push(
            `<line class="wall-hit" ${data} data-wall="${k}" x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" style="cursor:${cur}"><title>Drag to move this wall</title></line>`,
          );
        });
        if (opts.angles !== false && closed) {
          for (const c of cornerAngles(r.shape.path)) {
            const p = toScreen(v, c.at);
            // Just inside the corner, along the line halving it, and far enough out that the
            // whole (centred) text clears the corner's round handle: "225°" beside a corner
            // used to lose its ° under the handle.
            const text = formatAngle(c.angle);
            const halfW = (text.length * 6) / 2;
            const halfH = 5;
            const off = 8 + halfW * Math.abs(c.bisector.x) + halfH * Math.abs(c.bisector.y);
            const x = p.x + c.bisector.x * off;
            const y = p.y - c.bisector.y * off;
            const square = Math.abs(c.angle - 90) < 0.05 || Math.abs(c.angle - 270) < 0.05;
            labels.push(`<text class="angle-label${square ? " square" : ""}" x="${n(x)}" y="${n(y)}">${text}</text>`);
          }
        }
        // Corners: drag to move; click to pick one for Delete wall.
        const cs = [r.shape.path.start, ...segs.map((sg) => sg.to)].slice(0, closed ? segs.length : segs.length + 1);
        cs.forEach((c, i) => {
          const p = toScreen(v, c);
          const on = opts.activeCorner === i;
          handles.push(
            `<circle class="corner${on ? " active" : ""}" ${data} data-corner="${i}" cx="${n(p.x)}" cy="${n(p.y)}" r="${on ? 7 : 5}"><title>Corner ${i + 1}: drag to move it; click to pick it for Delete wall</title></circle>`,
          );
        });
      }
      if (selected && interactive) {
        const pen = toScreen(v, r.shape.path.segments.at(-1)?.to ?? r.shape.path.start);
        const start = toScreen(v, r.shape.path.start);
        parts.push(`<circle class="start-mark" cx="${n(start.x)}" cy="${n(start.y)}" r="4"/>`);
        parts.push(`<circle class="pen-mark" cx="${n(pen.x)}" cy="${n(pen.y)}" r="5"/>`);
        if (r.shape.path.segments.length === 0) {
          labels.push(
            `<text class="start-hint" x="${n(start.x + 10)}" y="${n(start.y - 12)}">Start of ${esc(r.area.name)}: type walls (e.g. R24 U30 L24 D30), or click elsewhere to move the start</text>`,
          );
        }
      }

      if (pts.length >= 3) {
        if (meta.showDims !== false && !r.area.hideDims) {
          const picked = opts.picked?.area === r.area.id && opts.picked.kind === "dim" ? (opts.picked.wall ?? null) : null;
          labels.push(dimensionLabels(r, v, interactive ? { data, picked } : null, ts));
        }
        if (meta.showLabels !== false && !r.area.hideLabel) {
          const c = toScreen(v, labelPoint(r));
          labels.push(
            `<g class="area-label${selected ? " selected" : ""}${opts.picked?.kind === "label" && opts.picked.area === r.area.id ? " picked" : ""}" ${data} data-label="1">` +
              `<text class="area-name" x="${n(c.x)}" y="${n(c.y - 2 * ts)}">${esc(r.area.name)}</text>` +
              `<text class="area-size" x="${n(c.x)}" y="${n(c.y + 12 * ts)}">${esc(areaSizeText(r))}</text>` +
              `<title>Drag to move the label; double-click to put it back; click, then Delete to hide it</title></g>`,
          );
        }
      }
    }
  }

  if (opts.preview && interactive) {
    const pv = opts.preview;
    const to = toScreen(v, pv.to);
    if (pv.from) {
      const from = toScreen(v, pv.from);
      parts.push(`<line class="iwall-preview" x1="${n(from.x)}" y1="${n(from.y)}" x2="${n(to.x)}" y2="${n(to.y)}"/>`);
      const len = Math.hypot(pv.to.x - pv.from.x, pv.to.y - pv.from.y);
      if (len > 1e-6) labels.push(`<text class="preview-len" x="${n(to.x + 12)}" y="${n(to.y - 10)}">${esc(formatLength(len))}</text>`);
    }
    handles.push(`<circle class="snap-mark snap-${pv.kind}" cx="${n(to.x)}" cy="${n(to.y)}" r="5"/>`);
  }

  for (const t of result.sketch.texts ?? []) {
    const p = toScreen(v, t.at);
    const on = interactive && opts.selectedText === t.id;
    labels.push(
      `<text class="room-label${on ? " selected" : ""}" data-text="${esc(t.id)}" x="${n(p.x)}" y="${n(p.y)}">${esc(t.text)}${interactive ? "<title>Drag to move; Delete removes it</title>" : ""}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}<g class="labels">${labels.join("")}</g>${handles.join("")}${doorHits.join("")}</svg>`;
}
