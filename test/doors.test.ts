import { describe, expect, it } from "vitest";
import { copyArea, defaultDoor, doorSymbol, parseVectors, seatDoor, snapToWall, wallSegments, type Area } from "../src/geometry/index.js";

const o = { x: 0, y: 0 };
const room = wallSegments([parseVectors("R24 U30 L24 CL", o).path]);

describe("doors sit in walls", () => {
  it("lists the straight walls of an outline, the closing wall too", () => {
    expect(room).toHaveLength(4);
    expect(wallSegments([parseVectors("R10 U10^2 L10 CL", o).path])).toHaveLength(3); // the curved wall takes no door
  });

  it("goes onto the nearest wall, facing along it", () => {
    const hit = snapToWall({ x: 10, y: 0.7 }, 3, room, 2)!;
    expect(hit.at).toEqual({ x: 10, y: 0 });
    expect(hit.angle).toBeCloseTo(0, 9);
    const right = snapToWall({ x: 23.5, y: 12 }, 3, room, 2)!;
    expect(right.at.x).toBeCloseTo(24, 9);
    expect(right.at.y).toBeCloseTo(12, 9);
    expect(right.angle).toBeCloseTo(90, 9);
  });

  it("is kept whole on its wall near a corner", () => {
    const hit = snapToWall({ x: 0.2, y: 0.1 }, 3, room, 2)!;
    expect(hit.at.y).toBeCloseTo(0, 9);
    expect(hit.at.x).toBeCloseTo(1.5, 9); // not hanging past the corner
  });

  it("is not placed far from any wall, or on one too short", () => {
    expect(snapToWall({ x: 12, y: 15 }, 3, room, 2)).toBeNull();
    expect(snapToWall({ x: 1, y: 0 }, 3, wallSegments([parseVectors("R2 U10", o).path]), 0.5)).toBeNull();
  });

  it("stays in its wall when the wall is nudged, keeping the way it faces", () => {
    const door = defaultDoor({ id: "d", at: { x: 10, y: 0 }, angle: 180, width: 3 });
    const moved = wallSegments([parseVectors("R24 U30 L24 CL", { x: 0, y: 0.5 }).path]);
    const seated = seatDoor(door, moved);
    expect(seated.at.y).toBeCloseTo(0.5, 9);
    expect(((seated.angle % 360) + 360) % 360).toBeCloseTo(180, 9);
    // Nothing near: left as it was.
    expect(seatDoor(door, wallSegments([parseVectors("R24 U30 L24 CL", { x: 0, y: 9 }).path]))).toEqual(door);
  });
});

describe("door symbols", () => {
  const base = defaultDoor({ id: "d", at: { x: 10, y: 0 }, angle: 0, width: 3 });

  it("a swing door: the leaf open at a right angle and the quarter circle it sweeps", () => {
    const s = doorSymbol(base);
    expect(s.a).toEqual({ x: 8.5, y: 0 });
    expect(s.b).toEqual({ x: 11.5, y: 0 });
    const [leaf, arc] = s.lines;
    expect(leaf).toEqual([{ x: 8.5, y: 0 }, { x: 8.5, y: 3 }]);
    expect(arc![0]!.x).toBeCloseTo(11.5, 9);
    expect(arc![arc!.length - 1]!.y).toBeCloseTo(3, 9);
    for (const p of arc!) expect(Math.hypot(p.x - 8.5, p.y)).toBeCloseTo(3, 9);
    expect(s.dashed).toBe(false);
  });

  it("flips its hinge and the side it opens to", () => {
    expect(doorSymbol({ ...base, hinge: "b" }).lines[0]).toEqual([{ x: 11.5, y: 0 }, { x: 11.5, y: 3 }]);
    expect(doorSymbol({ ...base, side: -1 }).lines[0]![1]).toEqual({ x: 8.5, y: -3 });
  });

  it("draws each kind", () => {
    expect(doorSymbol({ ...base, style: "double" }).lines).toHaveLength(4);
    expect(doorSymbol({ ...base, style: "sliding" }).lines).toHaveLength(2);
    expect(doorSymbol({ ...base, style: "bifold" }).lines).toHaveLength(2);
    expect(doorSymbol({ ...base, style: "pocket" }).dashed).toBe(true);
    expect(doorSymbol({ ...base, style: "overhead", width: 9 }).dashed).toBe(true);
    expect(doorSymbol({ ...base, style: "opening" }).lines).toHaveLength(0);
  });

  it("follows a wall at any angle", () => {
    const s = doorSymbol({ ...base, at: { x: 0, y: 0 }, angle: 90 });
    expect(s.a.x).toBeCloseTo(0, 9);
    expect(s.a.y).toBeCloseTo(-1.5, 9);
    expect(s.lines[0]![1]!.x).toBeCloseTo(-3, 9); // opens to the left of a wall running up
  });
});

describe("doors go with their area", () => {
  it("a copied area brings its doors along", () => {
    const src = { id: "a", name: "First", kind: "living", grade: "above", finished: true, level: "1", connected: true, ceiling: "full", origin: o, vectors: "R24 U30 L24 CL", zones: [], doors: [defaultDoor({ id: "d1", at: { x: 10, y: 0 } })] } as Area;
    let k = 0;
    const copy = copyArea(src, { x: 40, y: 5 }, (p) => `${p}${++k}`);
    expect(copy.doors).toHaveLength(1);
    expect(copy.doors![0]!.at).toEqual({ x: 50, y: 5 });
    expect(copy.doors![0]!.id).not.toBe("d1");
  });
});
