import { describe, expect, it } from "vitest";
import { area, flatten, hasWalls, insetPolygon, parseVectors, showsDetail } from "../src/geometry/index.js";

const corners = (text: string) => flatten(parseVectors(text).path, Math.PI / 48);
const size = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((a, p, i) => a + p.x * poly[(i + 1) % poly.length]!.y - poly[(i + 1) % poly.length]!.x * p.y, 0) / 2);

describe("the inside face of the walls", () => {
  it("a rectangle: in by the thickness on every side", () => {
    const inner = insetPolygon(corners("R24 U30 L24 CL"), 0.5)!;
    expect(inner).toHaveLength(4);
    expect(inner).toEqual([{ x: 0.5, y: 0.5 }, { x: 23.5, y: 0.5 }, { x: 23.5, y: 29.5 }, { x: 0.5, y: 29.5 }]);
  });

  it("the same whichever way round the outline was drawn", () => {
    const inner = insetPolygon(corners("U30 R24 D30 CL"), 0.5)!;
    expect(size(inner)).toBeCloseTo(23 * 29, 9);
    for (const p of inner) {
      expect(p.x > 0.49 && p.x < 23.51).toBe(true);
      expect(p.y > 0.49 && p.y < 29.51).toBe(true);
    }
  });

  it("an L: the inside corner steps in too", () => {
    const inner = insetPolygon(corners("R40 U24 L16 U12 L24 CL"), 8 / 12)!;
    expect(inner).toHaveLength(6);
    const t = 8 / 12;
    expect(inner[2]!.x).toBeCloseTo(40 - t, 9);
    expect(inner[2]!.y).toBeCloseTo(24 - t, 9);
    expect(inner[3]!.x).toBeCloseTo(24 - t, 9); // the notch corner moves toward the room
    expect(inner[3]!.y).toBeCloseTo(24 - t, 9);
    // Floor inside the walls: the outline less a band the thickness wide along the perimeter (corners counted once).
    expect(size(inner)).toBeCloseTo(1248 - 152 * t + 4 * t * t, 9);
  });

  it("a 45° bay keeps an even thickness along the slope", () => {
    const outer = corners("R4 DR2.83 R4 UR2.83 R4 U12 L16 CL");
    const inner = insetPolygon(outer, 0.5)!;
    expect(inner).toHaveLength(outer.length);
    // Every inside corner is at least the thickness from every wall line, never outside.
    for (const p of inner) {
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i]!;
        const b = outer[(i + 1) % outer.length]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const off = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len; // counter-clockwise outline: inside is positive
        const along = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
        if (along >= 0 && along <= len) expect(off).toBeGreaterThan(0.5 - 1e-6);
      }
    }
  });

  it("follows a curved wall", () => {
    const outer = corners("R20 U10 L20^3 CL");
    const inner = insetPolygon(outer, 0.5)!;
    expect(inner).toHaveLength(outer.length);
    expect(size(inner)).toBeLessThan(area(parseVectors("R20 U10 L20^3 CL").path));
  });

  it("gives nothing when the walls would fill the room", () => {
    expect(insetPolygon(corners("R2 U30 L2 CL"), 1)).toBeNull();
    expect(insetPolygon(corners("R24 U30 L24 CL"), 0)).toBeNull();
    expect(insetPolygon([{ x: 0, y: 0 }, { x: 5, y: 0 }], 0.5)).toBeNull();
  });

  it("only rooms have walls to draw", () => {
    expect(["living", "garage", "other"].map((k) => hasWalls(k as never))).toEqual([true, true, true]);
    expect(["deck", "porch", "patio", "carport", "breezeway"].map((k) => hasWalls(k as never))).toEqual([false, false, false, false, false]);
  });
});

describe("floor plan detail on or off", () => {
  const sketch = (meta: object, area: object = {}) =>
    ({ formatVersion: 1, meta: { ansi: true, ...meta }, structures: [{ id: "s", name: "Dwelling", kind: "dwelling", areas: [{ id: "a", zones: [], ...area }] }] }) as never;

  it("a sketch with none stays basic until it is turned on", () => {
    expect(showsDetail(sketch({}))).toBe(false);
    expect(showsDetail(sketch({ detail: true }))).toBe(true);
  });

  it("a sketch that already has some shows it, so nothing drawn before goes missing", () => {
    expect(showsDetail(sketch({}, { stairs: [{}] }))).toBe(true);
    expect(showsDetail(sketch({}, { walls: [{}] }))).toBe(true);
    expect(showsDetail(sketch({}, { doors: [{}] }))).toBe(true);
    expect(showsDetail(sketch({ wallThickness: 0.5 }))).toBe(true);
    expect(showsDetail(sketch({}, { stairs: [], walls: [], doors: [] }))).toBe(false);
  });

  it("turned off, it stays off even with detail in the sketch", () => {
    expect(showsDetail(sketch({ detail: false, wallThickness: 0.5 }, { stairs: [{}], doors: [{}] }))).toBe(false);
  });
});
