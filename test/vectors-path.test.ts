import { describe, expect, it } from "vitest";
import {
  area,
  bounds,
  closure,
  parseVectors,
  perimeter,
  selfIntersects,
  type Path,
} from "../src/geometry/index.js";

const shape = (text: string): Path => {
  const r = parseVectors(text);
  expect(r.errors).toEqual([]);
  return r.path;
};

/** Circular segment area by the classic formula, independent of the implementation's 4·atan form. */
function segmentArea(chord: number, s: number): number {
  const r = (chord * chord) / (8 * s) + s / 2;
  return r * r * Math.acos((r - s) / r) - (r - s) * Math.sqrt(2 * r * s - s * s);
}

describe("rectilinear outlines", () => {
  it("rectangle 24 x 30", () => {
    const p = shape("R24 U30 L24 D30");
    expect(area(p)).toBeCloseTo(720, 9);
    expect(perimeter(p)).toBeCloseTo(108, 9);
    expect(closure(p).closed).toBe(true);
  });

  it("clockwise gives the same area", () => {
    expect(area(shape("U30 R24 D30 L24"))).toBeCloseTo(720, 9);
  });

  it("L-shape: 40x24 plus 24x12 = 1,248", () => {
    expect(area(shape("R40 U24 L16 U12 L24 D36"))).toBeCloseTo(1248, 9);
  });

  it("feet-inches", () => {
    expect(area(shape("R24'6\" U30 L24'6\" D30"))).toBeCloseTo(735, 9);
  });

  it("compass letters, commas and new lines", () => {
    expect(area(shape("E24, N30\nW24, S30"))).toBeCloseTo(720, 9);
  });

  it("comments are ignored to end of line", () => {
    expect(area(shape("R24 U30 # front\nL24 D30 # side"))).toBeCloseTo(720, 9);
  });
});

describe("notched outline with a sloping wall", () => {
  // Re-entered from a past Total sketch (dimensions only). Total's breakdown:
  // 16'2" x 29'2" + 30'10" x 26'8" + 1/2 x 25'10" x 2" + 5' x 2'10" = 1,310.07 sf.
  const v = "R16'2\" D8'10\" R5 D2'10\" R25'10\"U2\" D26'10\" L30'10\" U9'2\" L16'2\" U29'2\"";

  it("closes exactly", () => {
    expect(closure(shape(v)).closed).toBe(true);
  });

  it("matches Total's area", () => {
    const parts = (16 + 2 / 12) * (29 + 2 / 12) + (30 + 10 / 12) * (26 + 8 / 12) + 0.5 * (25 + 10 / 12) * (2 / 12) + 5 * (2 + 10 / 12);
    expect(area(shape(v))).toBeCloseTo(parts, 9);
    expect(area(shape(v))).toBeCloseTo(1310.07, 2);
  });

  it("does not cross itself", () => {
    expect(selfIntersects(shape(v))).toBe(false);
  });
});

describe("diagonals and angles", () => {
  it("run/rise diagonal: right triangle 10 x 10 = 50", () => {
    expect(area(shape("R10 U10 L10D10"))).toBeCloseTo(50, 9);
  });

  it("45° wall measured along the wall", () => {
    const { path } = parseVectors("UR10");
    const end = path.segments[0]!.to;
    expect(end.x).toBeCloseTo(10 / Math.SQRT2, 12);
    expect(end.y).toBeCloseTo(10 / Math.SQRT2, 12);
  });

  it("45° bay: 16' front wall with a 2' deep bay, 12' house depth", () => {
    // Front: R4, 45° out 2'√2, R4 across the bay, 45° back, R4. Bay is a trapezoid of (8+4)/2*2 = 12 sf.
    const d = 2 * Math.SQRT2;
    const p = shape(`R4 DR${d} R4 UR${d} R4 U12 L16 D12`);
    expect(area(p)).toBeCloseTo(16 * 12 + 12, 9);
  });

  it("polar moves", () => {
    const { path } = parseVectors("A90:10 A30:12");
    expect(path.segments[0]!.to.x).toBe(0);
    expect(path.segments[0]!.to.y).toBeCloseTo(10, 12);
    expect(path.segments[1]!.to.x).toBeCloseTo(12 * Math.cos(Math.PI / 6), 12);
  });
});

describe("arcs", () => {
  it("semicircle: chord 20, depth 10", () => {
    const p = shape("R20^10 CL");
    expect(area(p)).toBeCloseTo((Math.PI * 100) / 2, 9);
    expect(perimeter(p)).toBeCloseTo(10 * Math.PI + 20, 9);
  });

  it("outward bay on a CCW rectangle adds a segment and bulges outside", () => {
    const p = shape("R20^3 U10 L20 D10");
    expect(area(p)).toBeCloseTo(200 + segmentArea(20, 3), 9);
    expect(bounds(p).minY).toBeCloseTo(-3, 3);
  });

  it("outward bay on a CW rectangle also adds and bulges outside", () => {
    const p = shape("U10 R20 D10 L20^3");
    expect(area(p)).toBeCloseTo(200 + segmentArea(20, 3), 9);
    expect(bounds(p).minY).toBeCloseTo(-3, 3);
  });

  it("inward arc subtracts", () => {
    const p = shape("R20^-3 U10 L20 D10");
    expect(area(p)).toBeCloseTo(200 - segmentArea(20, 3), 9);
    expect(bounds(p).minY).toBeCloseTo(0, 9);
  });

  it("arc deeper than a semicircle", () => {
    // chord 6, depth 9: r = 36/72 + 4.5 = 5; most of a circle of radius 5.
    const p = shape("R6^9 CL");
    expect(area(p)).toBeCloseTo(segmentArea(6, 9), 9);
    expect(area(p)).toBeGreaterThan((Math.PI * 25) / 2);
  });
});

describe("closing and errors", () => {
  it("CL adds the closing wall", () => {
    const p = shape("R24 U30 L24 CL");
    expect(p.segments).toHaveLength(4);
    expect(closure(p).closed).toBe(true);
    expect(area(p)).toBeCloseTo(720, 9);
  });

  it("CL snaps a near miss (under 1/8\") onto the start", () => {
    const p = shape("R24 U30 L24 D29.995 CL");
    expect(p.segments).toHaveLength(4);
    expect(p.segments[3]!.to).toEqual({ x: 0, y: 0 });
  });

  it("reports misclosure like a traverse", () => {
    const c = closure(shape("R24 U30 L24 D29"));
    expect(c.closed).toBe(false);
    expect(c.dy).toBeCloseTo(-1, 9);
    expect(c.distance).toBeCloseTo(1, 9);
  });

  it("length first reads the same as direction first", () => {
    const same = (a: string, b: string) => expect(parseVectors(a).path).toEqual(parseVectors(b).path);
    same("24R 30U 24L 30D", "R24 U30 L24 D30");
    same("24'6\"r 30u 24'6\"l cl", "R24'6\" U30 L24'6\" CL");
    same("10R5U", "R10U5"); // run and rise
    same("10UR 10ne", "UR10 NE10"); // 45° walls
    same("20R^3 20r^-3", "R20^3 R20^-3"); // arcs
    same("10-1/2\"R 24.5U", "R10-1/2\" U24.5");
    same("r10 5u 30R u20'6", "R10 U5 R30 U20'6"); // mixed in one outline
    expect(area(parseVectors("24R 30U 24L 30D").path)).toBeCloseTo(720, 9);
  });

  it("turns: length, direction, degrees from the wall before", () => {
    const end = (text: string) => {
      const p = parseVectors(text).path;
      return p.segments[p.segments.length - 1]!.to;
    };
    const h = 10.5 * Math.SQRT1_2;
    // Going right, then 10'6" turned 45° to the right heads down and right.
    expect(end("10R 10'6r45").x).toBeCloseTo(10 + h, 6);
    expect(end("10R 10'6r45").y).toBeCloseTo(-h, 6);
    // Turned left instead heads up and right.
    expect(end("10R 10'6l45").y).toBeCloseTo(h, 6);
    // Going up, a right turn of 90° is a wall to the right.
    expect(end("U10 5r90").x).toBeCloseTo(5, 9);
    expect(end("U10 5r90").y).toBeCloseTo(10, 9);
    // Each turn is from the wall just drawn: eight 45° turns make an octagon.
    const oct = parseVectors("10R 10l45 10l45 10l45 10l45 10l45 10l45 10l45").path;
    expect(closure(oct).distance).toBeCloseTo(0, 6);
    expect(area(oct)).toBeCloseTo(2 * (1 + Math.SQRT2) * 100, 4);
  });

  it("turns: first wall, and U or D, measure clockwise from that direction", () => {
    const p = parseVectors("10u45").path.segments[0]!.to;
    expect(p.x).toBeCloseTo(10 * Math.SQRT1_2, 6);
    expect(p.y).toBeCloseTo(10 * Math.SQRT1_2, 6);
    const q = parseVectors("R10 10d45").path.segments[1]!.to;
    expect(q.x).toBeCloseTo(10 - 10 * Math.SQRT1_2, 6);
    expect(q.y).toBeCloseTo(-10 * Math.SQRT1_2, 6);
  });

  it("turns: direction first with a colon reads the same", () => {
    const same = (a: string, b: string) => expect(parseVectors(a).path).toEqual(parseVectors(b).path);
    same("R10 R45:10'6", "10R 10'6r45");
    same("R10 L45:10'6 U22.5:4", "10R 10'6l45 4u22.5");
    same("R10 r45:20^3", "10R 20r45^3");
    expect(parseVectors("R10 R45:10'6").sources).toEqual(["R10", "A315:10'6"]);
    // Without the colon the digits run together and it is read as a plain length (10'645").
    expect(parseVectors("R10'645").errors.length + parseVectors("R10'645").path.segments.length).toBe(1);
  });

  it("a space stands for the foot mark: the first number after a wall is inches", () => {
    const same = (a: string, b: string) => expect(parseVectors(a).path).toEqual(parseVectors(b).path);
    same("R10 6 U30 0 L10 6 CL", "R10'6 U30 L10'6 CL");
    same("r10 6-1/2", "R10'6-1/2\"");
    same("r10 6.5", "R10'6.5\"");
    same("10 6r 30 0u", "R10'6 U30"); // length first
    same("10 6-1/2r", "R10'6-1/2\"");
    const r = parseVectors("R10 6 U5");
    expect(r.errors).toHaveLength(0);
    expect(r.sources).toEqual(["R10'6", "U5"]);
    expect(parseVectors("10 6r").sources).toEqual(["10'6r"]);
  });

  it("degrees come after a complete length", () => {
    const same = (a: string, b: string) => expect(parseVectors(a).path).toEqual(parseVectors(b).path);
    same("R10 r10 6 45", "10R 10'6r45"); // inches, then degrees
    same("R10 r10'6 45", "10R 10'6r45"); // marks, then degrees
    same("R10 r10 0 45", "10R 10r45"); // whole feet: 0 inches, then degrees
    same("R10 r10' 45", "10R 10r45"); // or a foot mark
    same("R10 10 6r 45", "10R 10'6r45"); // length first
    same("R10 10 6r45", "10R 10'6r45");
    same("10 6r 45 6u", "10'6R U45'6"); // a number before inches-and-direction starts the next wall
    same("R10 r6\" 45", "10R 6\"r45");
    same("12r 2.83' r 45 4' l 45", "12r"); // marks must touch their number: these are not walls
    same("12r r2.83' 45 l4 0 45 l2.83' 45 r12 0 45", "12r 2.83r45 4l45 2.83l45 12r45");
    expect(parseVectors("R10 R10 6 45 U5").sources).toEqual(["R10", "A315:10'6", "U5"]);
  });

  it("a number that cannot be inches is an error, not a guess at degrees", () => {
    const r = parseVectors("R10 R10 45 U5");
    expect(r.errors.map((e) => e.text)).toEqual(["45"]);
    expect(r.errors[0]!.message).toMatch(/inches must be under 12.*R10' 45/);
    expect(r.path.segments).toHaveLength(3); // the wall stays 10', unturned
    // Decimal feet take no inches.
    expect(parseVectors("R10.5 6").errors[0]!.message).toMatch(/foot mark before degrees/);
    // Numbers with nothing to belong to.
    expect(parseVectors("45 R10").errors.map((e) => e.text)).toEqual(["45"]);
    expect(parseVectors("R10 UR5 45").errors.map((e) => e.text)).toEqual(["45"]);
    expect(parseVectors("R10 R5 6 45 45").errors.map((e) => e.text)).toEqual(["45"]);
    expect(parseVectors("R10 45'").errors.map((e) => e.text)).toEqual(["45'"]);
    expect(parseVectors("R10 CL 5").errors.map((e) => e.text)).toEqual(["5"]);
  });

  it("turns: recorded as absolute walls for rewrites", () => {
    const r = parseVectors("10R 10'6r45 5U");
    expect(r.sources).toEqual(["10R", "A315:10'6", "5U"]);
    expect(parseVectors("R10 A315:10'6 U5").path).toEqual(r.path);
  });

  it("length first: bad tokens are still reported as typed", () => {
    const r = parseVectors("24R 5X 30U 10R5L 0R 24");
    expect(r.errors.map((e) => e.text)).toEqual(["5X", "10R5L", "0R", "24"]);
    expect(r.errors[0]!.message).toBe('unknown move "5X"');
  });

  it("bad tokens are reported and skipped", () => {
    const r = parseVectors("R24 X5 U30 R10L5 L24 D30 R0");
    expect(r.errors.map((e) => [e.token, e.text])).toEqual([
      [1, "X5"],
      [3, "R10L5"],
      [6, "R0"],
    ]);
    expect(r.errors[0]!.offset).toBe(4);
    expect(area(r.path)).toBeCloseTo(720, 9);
  });

  it("moves after CL are errors", () => {
    const r = parseVectors("R10 U10 L10 CL R5");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toMatch(/after CL/);
  });

  it("detects a self-crossing outline", () => {
    expect(selfIntersects(shape("R10 L10U10 R10 L10D10"))).toBe(true);
    expect(selfIntersects(shape("R40 U24 L16 U12 L24 D36"))).toBe(false);
    expect(selfIntersects(shape("R20^3 U10 L20 D10"))).toBe(false);
  });

  it("starts at the given origin", () => {
    const { path } = parseVectors("R10 U10 L10 D10", { x: 40, y: 5 });
    expect(path.segments[0]!.from).toEqual({ x: 40, y: 5 });
    expect(area(path)).toBeCloseTo(100, 9);
  });
});

describe("curly quotes", () => {
  it("are read as feet and inch marks, as a tablet keyboard types them", () => {
    const r = parseVectors("R24’6” U10′ L24‘6“ D10");
    expect(r.errors).toEqual([]);
    expect(r.path.segments[0]!.to).toEqual({ x: 24.5, y: 0 });
    expect(closure(r.path).closed).toBe(true);
  });

  it("keep error positions where they were typed", () => {
    const r = parseVectors("R24’6” X9");
    expect(r.errors.map((e) => e.offset)).toEqual([7]);
  });
});
