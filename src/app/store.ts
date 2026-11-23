/**
 * App state: the sketch document, the selection, and undo/redo history.
 * Every change goes through `update`, which records one history step
 * (consecutive changes with the same `coalesce` key, such as typing one wall
 * in the vector box, merge into a single step).
 */

import { FORMAT_VERSION, type Area, type Sketch, type Structure } from "../geometry/index.js";

export interface Selection {
  structure: string;
  area: string;
  /** A stair on that area, when one is selected. */
  stair?: string;
  /** A ceiling zone or opening on that area, when one is selected. */
  zone?: string;
  /** An interior wall on that area, when one is selected. */
  iwall?: string;
}

export interface State {
  sketch: Sketch;
  selection: Selection | null;
}

type Listener = (state: State) => void;

const HISTORY_LIMIT = 200;

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function newArea(over: Partial<Area> = {}): Area {
  return {
    id: newId("a"),
    name: "New area",
    kind: "living",
    grade: "above",
    finished: true,
    level: "1",
    connected: true,
    ceiling: "full",
    origin: { x: 0, y: 0 },
    vectors: "",
    zones: [],
    stairs: [],
    ...over,
  };
}

export function newStructure(over: Partial<Structure> = {}): Structure {
  return { id: newId("s"), name: "Dwelling", kind: "dwelling", areas: [], ...over };
}

export function newSketch(): Sketch {
  const first = newArea({ name: "First floor" });
  return {
    formatVersion: FORMAT_VERSION,
    meta: { ansi: true },
    structures: [newStructure({ areas: [first] })],
  };
}

/**
 * Coalesce key for typing in a walls box. Keystrokes merge into one undo step
 * only while they keep adding to (or keep deleting from) the same wall, so
 * each wall typed or deleted is its own step and Ctrl+Z walks back one wall
 * at a time instead of emptying the whole outline.
 */
export function typingStep(base: string, before: string, after: string): string {
  const walls = after.trim() === "" ? 0 : after.trim().split(/\s+/).length;
  const dir = after.length < before.length ? "del" : "add";
  return `${base}#${walls}${dir}`;
}

export class Store {
  private current: State;
  private past: { sketch: Sketch; selection: Selection | null }[] = [];
  private future: { sketch: Sketch; selection: Selection | null }[] = [];
  private lastCoalesce: string | null = null;
  private listeners = new Set<Listener>();
  /** Bumped on every document change (not selection), for "unsaved" tracking. */
  revision = 0;

  constructor(sketch: Sketch) {
    const s = sketch.structures[0];
    const a = s?.areas[0];
    this.current = { sketch, selection: s && a ? { structure: s.id, area: a.id } : null };
  }

  get state(): State {
    return this.current;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }

  /** Apply a change to a copy of the sketch and record it for undo. */
  update(fn: (draft: Sketch) => Selection | null | void, opts: { coalesce?: string } = {}): void {
    const draft = structuredClone(this.current.sketch);
    const sel = fn(draft);
    const coalesce = opts.coalesce ?? null;
    if (coalesce === null || coalesce !== this.lastCoalesce) {
      this.past.push({ sketch: this.current.sketch, selection: this.current.selection });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.lastCoalesce = coalesce;
    this.current = { sketch: draft, selection: sel === undefined ? this.current.selection : sel };
    this.current.selection = this.validSelection(this.current.selection);
    this.revision += 1;
    this.emit();
  }

  /** Replace the whole document (open file, new sketch). Clears history. */
  load(sketch: Sketch): void {
    this.past = [];
    this.future = [];
    this.lastCoalesce = null;
    const s = sketch.structures[0];
    const a = s?.areas[0];
    this.current = { sketch, selection: s && a ? { structure: s.id, area: a.id } : null };
    this.revision += 1;
    this.emit();
  }

  select(selection: Selection | null): void {
    this.current = { ...this.current, selection: this.validSelection(selection) };
    this.lastCoalesce = null;
    this.emit();
  }

  /** End any coalescing run, so the next change is its own undo step. */
  breakCoalesce(): void {
    this.lastCoalesce = null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push({ sketch: this.current.sketch, selection: this.current.selection });
    this.current = { sketch: prev.sketch, selection: this.validSelection(prev.selection, prev.sketch) };
    this.lastCoalesce = null;
    this.revision += 1;
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push({ sketch: this.current.sketch, selection: this.current.selection });
    this.current = { sketch: next.sketch, selection: this.validSelection(next.selection, next.sketch) };
    this.lastCoalesce = null;
    this.revision += 1;
    this.emit();
  }

  private validSelection(sel: Selection | null, sketch: Sketch = this.current.sketch): Selection | null {
    if (!sel) return null;
    const s = sketch.structures.find((x) => x.id === sel.structure);
    const a = s?.areas.find((x) => x.id === sel.area);
    if (!s || !a) return null;
    if (sel.stair && !(a.stairs ?? []).some((st) => st.id === sel.stair)) return { structure: s.id, area: a.id };
    if (sel.zone && !a.zones.some((z) => z.id === sel.zone)) return { structure: s.id, area: a.id };
    if (sel.iwall && !(a.walls ?? []).some((w) => w.id === sel.iwall)) return { structure: s.id, area: a.id };
    return sel;
  }
}

/** Find an area in a sketch (or draft) by selection. */
export function findArea(sketch: Sketch, sel: Selection | null): { structure: Structure; area: Area } | null {
  if (!sel) return null;
  const structure = sketch.structures.find((s) => s.id === sel.structure);
  const area = structure?.areas.find((a) => a.id === sel.area);
  return structure && area ? { structure, area } : null;
}
