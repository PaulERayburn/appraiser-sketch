/**
 * Length parsing and formatting. Internal unit: decimal feet.
 *
 * Accepted input forms:
 *   24        24.5      decimal feet
 *   24'       24'6"     24'6      feet-inches
 *   6"        6-1/2"    inches, with optional fraction
 *   24'6-1/2" 24'6.5"   feet + fractional/decimal inches
 *   10'6+4'6  20'6+-10' sums and differences of any of the above
 */

const FEET_INCHES = /^(?:(\d+(?:\.\d+)?)')?(?:(\d+(?:\.\d+)?)(?:-(\d+)\/(\d+))?("?))?$/;

/**
 * Parse a length token to decimal feet, or return null if it is not a valid length.
 * Lengths may be added up as they are measured: 10'6+4'6 is 15'. To take a piece
 * off, use +- or a true minus sign: 20'6+-10' or 20'6−10'. A plain hyphen never
 * subtracts, because 24'-6" and 6-1/2" are ordinary ways to write one length.
 */
export function parseLength(raw: string): number | null {
  const text = raw.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!/[+−]/.test(text)) return parseOneLength(text);
  let total = 0;
  for (const [k, term] of text.split(/(?=[+−])/).entries()) {
    const signed = /^[+−]/.test(term);
    if (signed !== k > 0) return null; // no sign in front of the first length
    let body = signed ? term.slice(1) : term;
    let sign = term.startsWith("−") ? -1 : 1;
    if (term.startsWith("+-")) {
      sign = -1;
      body = body.slice(1);
    }
    const v = parseOneLength(body);
    if (v === null) return null;
    total += sign * v;
  }
  return total > 1e-9 ? total : null;
}

function parseOneLength(text: string): number | null {
  if (text === "") return null;

  // Plain decimal feet (no unit marks).
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);

  const m = FEET_INCHES.exec(text);
  if (!m) return null;
  const [, feetStr, inchStr, num, den, inchMark] = m;
  const hasFeetMark = feetStr !== undefined;

  // Without a feet mark, the number must carry an inch mark ("6\"", "6-1/2\"").
  if (!hasFeetMark && inchMark !== '"') return null;
  if (!hasFeetMark && inchStr === undefined) return null;

  let inches = inchStr !== undefined ? Number(inchStr) : 0;
  if (num !== undefined && den !== undefined) {
    const d = Number(den);
    if (d === 0) return null;
    inches += Number(num) / d;
  }
  const feet = hasFeetMark ? Number(feetStr) : 0;
  if (hasFeetMark && inches >= 12) return null; // 24'14" is a typo
  return feet + inches / 12;
}

/**
 * Format decimal feet as feet-inches rounded to the nearest inch (ANSI precision),
 * e.g. 24.5 -> 24'6".
 */
export function formatFeetInches(feet: number): string {
  const sign = feet < 0 ? "-" : "";
  let totalInches = Math.round(Math.abs(feet) * 12);
  const ft = Math.floor(totalInches / 12);
  totalInches -= ft * 12;
  return totalInches === 0 ? `${sign}${ft}'` : `${sign}${ft}'${totalInches}"`;
}

/** How lengths are shown and written: feet-inches (24'6") or decimal feet (24.5'). */
export type LengthStyle = "ftin" | "decimal";
let style: LengthStyle = "ftin";

export function setLengthStyle(s: LengthStyle): void {
  style = s;
}
export function lengthStyle(): LengthStyle {
  return style;
}
/** The arrow-key step: 1 inch, or a tenth of a foot. */
export function smallStep(): number {
  return style === "decimal" ? 0.1 : 1 / 12;
}

/** Decimal feet to two places, trimmed: 24.5 -> 24.5', 24.0833 -> 24.08', 24 -> 24'. */
export function formatDecimalFeet(feet: number): string {
  const v = roundTo(feet, 2);
  return `${Number.isInteger(v) ? v.toFixed(0) : String(v)}'`;
}

/** A length in the chosen style. */
export function formatLength(feet: number): string {
  return style === "decimal" ? formatDecimalFeet(feet) : formatFeetInches(feet);
}

/** Round to a number of decimal places without binary-float artifacts in typical sizes. */
export function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Format square feet with thousands separators, e.g. 1248.04 -> "1,248.0". */
export function formatSqFt(sqft: number, places = 1): string {
  return roundTo(sqft, places).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}
