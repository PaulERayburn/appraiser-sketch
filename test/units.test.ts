import { describe, expect, it } from "vitest";
import { formatFeetInches, formatSqFt, parseLength } from "../src/geometry/index.js";

describe("parseLength", () => {
  it.each([
    ["24", 24],
    ["24.5", 24.5],
    ["24'", 24],
    ["24'6\"", 24.5],
    ["24'6", 24.5],
    ["24’6”", 24.5],
    ["6\"", 0.5],
    ["6-1/2\"", 6.5 / 12],
    ["24'6-1/2\"", 24 + 6.5 / 12],
    ["24'6.5\"", 24 + 6.5 / 12],
    ["0'11\"", 11 / 12],
  ])("%s -> %f ft", (text, feet) => {
    expect(parseLength(text)).toBeCloseTo(feet, 12);
  });

  it.each(["", "abc", "24'14\"", "6-1/2", "6-1/0\"", "'", "\"", "24''", "-5"])("rejects %j", (text) => {
    expect(parseLength(text)).toBeNull();
  });
});

describe("adding and subtracting lengths", () => {
  it.each([
    ["10'6+4'6", 15],
    ["10'6\"+4'6\"", 15],
    ["12'4+6'5+3\"", 19],
    ["10+4.5", 14.5],
    ["10'6-1/2\"+6-1/2\"", 10 + 13 / 12],
    ["20'6+-10'", 10.5],
    ["20'6−10'", 10.5],
    ["20'6+4'−10'+-6\"", 14],
  ])("%s -> %f ft", (text, feet) => {
    expect(parseLength(text)).toBeCloseTo(feet, 12);
  });

  it.each(["+10", "10+", "10++4", "10+abc", "10'+-10'", "4'+-10'", "−4", "10+-", "24'-6\"", "24-6", "20'6-10'"])("rejects %j", (text) => {
    expect(parseLength(text)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats feet-inches to the nearest inch", () => {
    expect(formatFeetInches(24.5)).toBe("24'6\"");
    expect(formatFeetInches(24)).toBe("24'");
    expect(formatFeetInches(24.04)).toBe("24'");
    expect(formatFeetInches(11.999)).toBe("12'");
    expect(formatFeetInches(0.5)).toBe("0'6\"");
  });

  it("formats square feet", () => {
    expect(formatSqFt(1248.04)).toBe("1,248.0");
    expect(formatSqFt(1247.96, 0)).toBe("1,248");
  });
});
