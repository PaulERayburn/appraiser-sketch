import { describe, expect, it } from "vitest";
import { defaultStair, stairDrawing, stairHandles, stairPlan } from "../src/geometry/index.js";

const T = 10 / 12; // tread depth
const box = (poly: { x: number; y: number }[]) => ({
  x0: Math.min(...poly.map((p) => p.x)),
  x1: Math.max(...poly.map((p) => p.x)),
  y0: Math.min(...poly.map((p) => p.y)),
  y1: Math.max(...poly.map((p) => p.y)),
});

describe("a stair built from steps", () => {
  it("2 steps up, a square landing, 8 to the right", () => {
    const s = stairPlan("2u sq r8", 3);
    expect(s.errors).toEqual([]);
    expect(s.steps).toBe(10);
    expect(s.parts).toHaveLength(3);
    const [up, landing, right] = s.parts.map(box);
    expect(up).toEqual({ x0: 0, x1: 3, y0: 0, y1: 2 * T });
    expect(landing!.y1 - landing!.y0).toBeCloseTo(3, 9);
    expect(landing!.x1 - landing!.x0).toBeCloseTo(3, 9);
    // The second flight leaves the landing's right side.
    expect(right!.x0).toBeCloseTo(3, 9);
    expect(right!.x1).toBeCloseTo(3 + 8 * T, 9);
    expect(right!.y0).toBeCloseTo(2 * T, 9);
    expect(s.lines).toHaveLength(1 + 7); // tread lines inside each flight
    expect(s.footprint).toBeCloseTo(3 * 2 * T + 9 + 3 * 8 * T, 9);
  });

  it("reads the same written other ways", () => {
    const a = stairPlan("2u sq r8", 3);
    for (const text of ["st2u sq r8", "u2 sq 8r", "2U SQ R8", "2 steps up, square landing, 8 to the right", "2 up landing 8 right"]) {
      const b = stairPlan(text, 3);
      expect(b.errors).toEqual([]);
      expect(b.parts).toEqual(a.parts);
    }
  });

  it("a 90° corner of 3 pie-shaped steps", () => {
    const s = stairPlan("st2u (rad 90 3rise)", 3);
    expect(s.errors).toEqual([]);
    expect(s.steps).toBe(5);
    expect(s.parts).toHaveLength(2);
    // Two winder lines fan out from the inside of the turn, 30° apart.
    const winders = s.lines.slice(1);
    expect(winders).toHaveLength(2);
    const inner = { x: 3, y: 2 * T }; // turning right: the newel is the near right corner
    for (const [from] of winders) expect(from).toEqual(inner);
    const angles = winders.map(([from, to]) => (Math.atan2(to.y - from.y, from.x - to.x) * 180) / Math.PI);
    expect(angles[0]!).toBeCloseTo(30, 6);
    expect(angles[1]!).toBeCloseTo(60, 6);
    // Each line reaches the outside of the corner.
    for (const [, to] of winders) expect(Math.min(Math.abs(to.x - 0), Math.abs(to.y - (2 * T + 3)))).toBeCloseTo(0, 9);
  });

  it("winders turn the way the next flight goes", () => {
    const right = stairPlan("4u rad r4", 3);
    const left = stairPlan("4u rad l4", 3);
    expect(right.errors.concat(left.errors)).toEqual([]);
    expect(box(right.parts[2]!).x0).toBeCloseTo(3, 9);
    expect(box(left.parts[2]!).x1).toBeCloseTo(0, 9);
    expect(stairPlan("4u rad 4rise l4", 3).steps).toBe(12);
    expect(stairPlan("4u rad 3 l4", 3).steps).toBe(11);
    expect(stairPlan("4u rad 6 steps left", 3).steps).toBe(4 + 3 + 6); // 6 is the next flight
  });

  it("a U: across a double landing and back, or round 180° of winders", () => {
    const u = stairPlan("6u sq r sq d6", 3);
    expect(u.errors).toEqual([]);
    expect(u.parts).toHaveLength(4);
    const back = box(u.parts[3]!);
    expect(back).toEqual({ x0: 3, x1: 6, y0: 6 * T + 3 - 3 - 6 * T + 0, y1: 6 * T });
    const round = stairPlan("6u rad 180 6rise d6", 3);
    expect(round.errors).toEqual([]);
    expect(round.steps).toBe(18);
    expect(box(round.parts[3]!).x0).toBeCloseTo(3, 9);
  });

  it("flights can be given as a length", () => {
    const s = stairPlan("u7'6 sq r4'", 3);
    expect(s.errors).toEqual([]);
    expect(box(s.parts[0]!).y1).toBeCloseTo(7.5, 9);
    expect(s.steps).toBe(9 + 5);
  });

  it("says what it cannot read, and draws the rest", () => {
    expect(stairPlan("2u r8", 3).errors[0]).toMatch(/landing \(sq\) or winders \(rad\) before turning/);
    expect(stairPlan("2u r8", 3).parts).toHaveLength(1);
    expect(stairPlan("2u sq d4", 3).errors[0]).toMatch(/double back/);
    expect(stairPlan("2u xyz", 3).errors[0]).toMatch(/"xyz"/);
    expect(stairPlan("2u 5", 3).errors[0]).toMatch(/which way/);
    expect(stairPlan("2u rad 30", 3).steps).toBe(2 + 30); // under 45 is a count of steps
    expect(stairPlan("2u rad 120", 3).errors[0]).toMatch(/90 or 180/);
    expect(stairPlan("", 3).parts).toHaveLength(0);
  });

  it("is drawn like any other stair: placed, rotated, no drag handles", () => {
    const st = defaultStair({ id: "t", type: "steps", plan: "2u sq r8", origin: { x: 10, y: 20 }, width: 3 });
    const d = stairDrawing(st);
    expect(box(d.parts[0]!)).toEqual({ x0: 10, x1: 13, y0: 20, y1: 20 + 2 * T });
    expect(d.arrow.length).toBeGreaterThan(2);
    expect(stairHandles(st)).toEqual([]);
    const turned = stairDrawing({ ...st, rotation: 90 });
    expect(box(turned.parts[0]!).x0).toBeCloseTo(10 - 2 * T, 9);
    // An empty plan still shows a square to click.
    expect(stairDrawing({ ...st, plan: "" }).parts).toHaveLength(1);
  });
});
