/**
 * Open/save .sketch.json files. Uses the File System Access API where the
 * browser has it (Chrome, Edge) so Save writes back to the same file, and
 * falls back to download/upload elsewhere. Also keeps a crash-recovery draft
 * in localStorage (best effort; may be unavailable).
 */

import {
  BUCKETS,
  FORMAT_VERSION,
  GRADES,
  STAIR_TYPES,
  STRUCTURE_KINDS,
  ZONE_BANDS,
  DOOR_STYLES,
  defaultDoor,
  defaultStair,
  type Door,
  type Area,
  type AreaKind,
  type CeilingBand,
  type InteriorWall,
  type Override,
  type Point,
  type Sketch,
  type SketchMeta,
  type Stair,
  type Structure,
  type TextLabel,
  type Zone,
  type ZoneKind,
  type Slope,
} from "../geometry/index.js";
import { newArea, newId } from "./store.js";

const DRAFT_KEY = "sketch:draft";

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (opts: unknown) => Promise<FileHandle>;
};

const PICKER_TYPES = [{ description: "Appraiser Sketch", accept: { "application/json": [".sketch.json", ".json"] } }];

export class SketchFileError extends Error {}

type Raw = Record<string, unknown>;

/** A file that parses as JSON but would not draw: say which part is wrong rather than load it. */
function damaged(where: string): never {
  throw new SketchFileError(`This sketch file is damaged (${where}).`);
}

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Field readers: a missing field takes its default (older files); one of the wrong type is damage. */
function str(o: Raw, key: string, where: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return typeof v === "string" ? v : damaged(`${where}: ${key}`);
}
function bool(o: Raw, key: string, where: string): boolean | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return typeof v === "boolean" ? v : damaged(`${where}: ${key}`);
}
function oneOf<T extends string>(o: Raw, key: string, allowed: readonly T[], where: string): T | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return allowed.includes(v as T) ? (v as T) : damaged(`${where}: ${key}`);
}
function num(o: Raw, key: string, where: string): number | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : damaged(`${where}: ${key}`);
}
function point(o: Raw, key: string, where: string): Point | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (!isObject(v) || typeof v.x !== "number" || typeof v.y !== "number" || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
    return damaged(`${where}: ${key}`);
  }
  return { x: v.x, y: v.y };
}
function list(o: Raw, key: string, where: string): Raw[] {
  const v = o[key];
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isObject)) return damaged(`${where}: ${key}`);
  return v as Raw[];
}
/** Drop undefined values, so defaults apply and no optional field is stored as undefined. */
function defined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

const AREA_KINDS: readonly AreaKind[] = ["living", "garage", "porch", "deck", "patio", "carport", "breezeway", "other"];
const CEILINGS: readonly CeilingBand[] = ["full", "reduced", "low"];

function readSlope(z: Raw, where: string): Slope | undefined {
  if (z.slope === undefined) return undefined;
  if (!isObject(z.slope)) damaged(`${where}: slope`);
  const o = z.slope as Raw;
  const w = `${where}, slope`;
  const height = (key: string) => {
    const v = num(o, key, w);
    return v !== undefined && v >= 0 ? v : damaged(`${w}: ${key}`);
  };
  return {
    from: point(o, "from", w) ?? damaged(`${w}: from`),
    to: point(o, "to", w) ?? damaged(`${w}: to`),
    fromHeight: height("fromHeight"),
    toHeight: height("toHeight"),
  };
}

function readZone(z: Raw, where: string): Zone {
  const kinds: ZoneKind[] = [...ZONE_BANDS.map((b) => b.value), "sloped"];
  return {
    id: str(z, "id", where) ?? newId("z"),
    ...defined({ name: str(z, "name", where) }),
    band: oneOf(z, "band", kinds, where) ?? damaged(`${where}: band`),
    origin: point(z, "origin", where) ?? damaged(`${where}: origin`),
    vectors: str(z, "vectors", where) ?? "",
    ...defined({ slope: readSlope(z, where) }),
  };
}

function readWall(w: Raw, where: string): InteriorWall {
  return {
    id: str(w, "id", where) ?? newId("w"),
    origin: point(w, "origin", where) ?? damaged(`${where}: origin`),
    vectors: str(w, "vectors", where) ?? "",
  };
}

function readStair(st: Raw, where: string): Stair {
  const positive = (key: string) => {
    const v = num(st, key, where);
    return v === undefined || v > 0 ? v : damaged(`${where}: ${key}`);
  };
  return defaultStair(
    defined({
      id: str(st, "id", where) ?? newId("t"),
      type: oneOf(st, "type", STAIR_TYPES.map((t) => t.value), where),
      origin: point(st, "origin", where),
      rotation: num(st, "rotation", where),
      width: positive("width"),
      run1: positive("run1"),
      run2: positive("run2"),
      turn: oneOf(st, "turn", ["left", "right"] as const, where),
      direction: oneOf(st, "direction", ["up", "down"] as const, where),
      plan: str(st, "plan", where),
    }),
  );
}

function readDoor(d: Raw, where: string): Door {
  const width = num(d, "width", where);
  const side = num(d, "side", where);
  return defaultDoor(
    defined({
      id: str(d, "id", where) ?? newId("d"),
      at: point(d, "at", where),
      angle: num(d, "angle", where),
      width: width === undefined || width > 0 ? width : damaged(`${where}: width`),
      style: oneOf(d, "style", DOOR_STYLES.map((t) => t.value), where),
      hinge: oneOf(d, "hinge", ["a", "b"] as const, where),
      side: side === undefined ? undefined : side < 0 ? (-1 as const) : (1 as const),
    }),
  );
}

function readArea(a: Raw, where: string): Area {
  let override: Override | undefined;
  if (a.override !== undefined) {
    if (!isObject(a.override)) damaged(`${where}: override`);
    const o = a.override as Raw;
    override = { bucket: oneOf(o, "bucket", BUCKETS, where) ?? damaged(`${where}: override`), note: str(o, "note", where) ?? "" };
  }
  const walls = list(a, "walls", where).map((w, i) => readWall(w, `${where}, interior wall ${i + 1}`));
  const doors = list(a, "doors", where).map((d, i) => readDoor(d, `${where}, door ${i + 1}`));
  let hiddenDims: number[] | undefined;
  if (a.hiddenDims !== undefined) {
    const h = a.hiddenDims;
    if (!Array.isArray(h) || !h.every((k) => Number.isInteger(k) && k >= 0)) damaged(`${where}: hiddenDims`);
    if ((h as number[]).length) hiddenDims = h as number[];
  }
  return newArea(
    defined({
      id: str(a, "id", where) ?? newId("a"),
      name: str(a, "name", where),
      kind: oneOf(a, "kind", AREA_KINDS, where),
      grade: oneOf(a, "grade", GRADES, where),
      finished: bool(a, "finished", where),
      level: str(a, "level", where),
      connected: bool(a, "connected", where),
      ceiling: oneOf(a, "ceiling", CEILINGS, where),
      origin: point(a, "origin", where),
      vectors: str(a, "vectors", where),
      zones: list(a, "zones", where).map((z, i) => readZone(z, `${where}, zone ${i + 1}`)),
      stairs: list(a, "stairs", where).map((st, i) => readStair(st, `${where}, stair ${i + 1}`)),
      walls: walls.length ? walls : undefined,
      doors: doors.length ? doors : undefined,
      override,
      label: point(a, "label", where),
      hideLabel: bool(a, "hideLabel", where) || undefined,
      hideDims: bool(a, "hideDims", where) || undefined,
      hiddenDims,
    }),
  );
}

/** A wall thickness in feet: more than nothing, and no thicker than 3'. */
function thickness(m: Raw, key: string): number | undefined {
  const v = num(m, key, "header");
  return v === undefined || (v > 0 && v <= 3) ? v : damaged(`header: ${key}`);
}

function readMeta(raw: unknown): SketchMeta {
  if (raw === undefined) return { ansi: true };
  if (!isObject(raw)) damaged("header");
  const m = raw as Raw;
  return {
    ansi: bool(m, "ansi", "header") ?? true,
    ...defined({
      subject: str(m, "subject", "header"),
      client: str(m, "client", "header"),
      borrower: str(m, "borrower", "header"),
      fileNumber: str(m, "fileNumber", "header"),
      appraiser: str(m, "appraiser", "header"),
      date: str(m, "date", "header"),
      showDims: bool(m, "showDims", "header"),
      showLabels: bool(m, "showLabels", "header"),
      wallThickness: thickness(m, "wallThickness"),
      interiorWallThickness: thickness(m, "interiorWallThickness"),
    }),
  };
}

/**
 * Parse and check a sketch file; throws SketchFileError with a readable
 * message. Every field is checked before the sketch is handed to the app, so a
 * damaged or hand-edited file is refused here instead of breaking the drawing
 * (and then being kept as the recovery draft).
 */
export function parseSketchFile(text: string): Sketch {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SketchFileError("This file is not a sketch (not valid JSON).");
  }
  if (!isObject(raw) || !Array.isArray(raw.structures)) {
    throw new SketchFileError("This file is not a sketch (no structures).");
  }
  if (typeof raw.formatVersion !== "number") {
    throw new SketchFileError("This file is not a sketch (no format version).");
  }
  if (raw.formatVersion > FORMAT_VERSION) {
    throw new SketchFileError(`This sketch was saved by a newer version (format ${String(raw.formatVersion)}).`);
  }
  const structures: Structure[] = raw.structures.map((s: unknown, i: number) => {
    const where = `structure ${i + 1}`;
    if (!isObject(s)) return damaged(where);
    return {
      id: str(s, "id", where) ?? newId("s"),
      name: str(s, "name", where) ?? "Structure",
      kind: oneOf(s, "kind", STRUCTURE_KINDS.map((k) => k.value), where) ?? "dwelling",
      areas: list(s, "areas", where).map((a, j) => readArea(a, `${where}, area ${j + 1}`)),
    };
  });
  // Room labels are decoration: a bad one is dropped rather than refusing the file.
  const texts: TextLabel[] = Array.isArray(raw.texts)
    ? (raw.texts as unknown[])
        .filter((t): t is Raw & { text: string; at: Point } => isObject(t) && typeof t.text === "string" && isObject(t.at) && Number.isFinite(t.at.x) && Number.isFinite(t.at.y))
        .map((t) => ({ id: typeof t.id === "string" ? t.id : newId("t"), text: t.text, at: { x: t.at.x, y: t.at.y } }))
    : [];
  return { formatVersion: FORMAT_VERSION, meta: readMeta(raw.meta), structures, texts };
}

export function serialize(sketch: Sketch): string {
  return JSON.stringify(sketch, null, 2) + "\n";
}

function suggestedName(sketch: Sketch): string {
  const base = sketch.meta.fileNumber || sketch.meta.subject || "sketch";
  return `${base.replace(/[^\w .-]+/g, "_").trim() || "sketch"}.sketch.json`;
}

export class FileManager {
  private handle: FileHandle | null = null;
  name: string | null = null;

  get hasPicker(): boolean {
    return typeof (window as PickerWindow).showSaveFilePicker === "function";
  }

  /** Ask for a file and return its sketch, or null if the user cancelled. */
  async open(): Promise<Sketch | null> {
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
        if (!h) return null;
        const sketch = parseSketchFile(await (await h.getFile()).text());
        this.handle = h;
        this.name = h.name;
        return sketch;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return null;
        throw e;
      }
    }
    const file = await pickFileFallback();
    if (!file) return null;
    const sketch = parseSketchFile(await file.text());
    this.handle = null;
    this.name = file.name;
    return sketch;
  }

  /** Save to the current file, or ask where (Save As) if there is none. Returns false if cancelled. */
  async save(sketch: Sketch, saveAs = false): Promise<boolean> {
    const w = window as PickerWindow;
    const data = serialize(sketch);
    if (w.showSaveFilePicker) {
      try {
        if (!this.handle || saveAs) {
          this.handle = await w.showSaveFilePicker({ types: PICKER_TYPES, suggestedName: this.name ?? suggestedName(sketch) });
        }
        const out = await this.handle.createWritable();
        await out.write(data);
        await out.close();
        this.name = this.handle.name;
        return true;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return false;
        throw e;
      }
    }
    download(data, this.name ?? suggestedName(sketch));
    this.name ??= suggestedName(sketch);
    return true;
  }

  /**
   * Save a companion file (e.g. the report export). The dialog opens in the
   * folder of the current sketch file where the browser allows it. Returns the
   * saved name, or null if cancelled.
   */
  async saveCompanion(data: string, name: string, description: string, ext: string): Promise<string | null> {
    const w = window as PickerWindow;
    if (w.showSaveFilePicker) {
      try {
        const h = await w.showSaveFilePicker({
          types: [{ description, accept: { "application/json": [ext] } }],
          suggestedName: name,
          ...(this.handle ? { startIn: this.handle } : {}),
        });
        const out = await h.createWritable();
        await out.write(data);
        await out.close();
        return h.name;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return null;
        throw e;
      }
    }
    download(data, name);
    return name;
  }

  reset(): void {
    this.handle = null;
    this.name = null;
  }
}

function pickFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export function download(data: string | Blob, name: string, type = "application/json"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveDraft(sketch: Sketch): void {
  try {
    localStorage.setItem(DRAFT_KEY, serialize(sketch));
  } catch {
    /* storage unavailable; drafts are best effort */
  }
}

/** Where a draft that could not be read is kept, so it is never simply lost. */
const REJECTED_DRAFT_KEY = "sketch:draft-rejected";
let draftRejected = false;

/** True if the draft found at startup could not be read (a copy was kept in this browser). */
export function draftWasRejected(): boolean {
  return draftRejected;
}

export function loadDraft(): Sketch | null {
  let text: string | null = null;
  try {
    text = localStorage.getItem(DRAFT_KEY);
    return text ? parseSketchFile(text) : null;
  } catch {
    // The next edit overwrites the draft, so set the unreadable one aside first.
    if (text) {
      draftRejected = true;
      try {
        localStorage.setItem(REJECTED_DRAFT_KEY, text);
      } catch {
        /* storage unavailable */
      }
    }
    return null;
  }
}
