/**
 * Where a place is, for the map (augur ADR 0071). A `place` detail holds words
 * or a point. A point is written as latitude and longitude in decimal degrees
 * (WGS84), comma separated: "57.70, 11.97". It's kept as text, like every
 * value, so facts keep their two clocks and floors, and a run of positions over
 * valid time is a movement.
 */
export interface Point {
  lat: number;
  lon: number;
}

/** Two numbers with a comma between: what a point looks like, whether or not it's in range. */
const LOOKS_LIKE = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/;

/** Decimal places kept: six is about ten centimetres, finer than any position people type. */
const PLACES = 6;

/** The point a value holds, or undefined when it's words (or a point out of range). */
export const parsePoint = (value: string): Point | undefined => {
  const m = LOOKS_LIKE.exec(value);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
};

/** Whether a value is written as a point, in range or not. */
export const looksLikePoint = (value: string) => LOOKS_LIKE.test(value);

/** A point in the one form it's kept in: "57.7, 11.97". */
export const formatPoint = ({ lat, lon }: Point) => `${Number(lat.toFixed(PLACES))}, ${Number(lon.toFixed(PLACES))}`;

/** Why a value written as a point won't do, in words; undefined when it's a point in range, or words. */
export const pointProblem = (label: string, value: string): string | undefined => {
  if (!looksLikePoint(value) || parsePoint(value)) return undefined;
  return `${label} looks like a point but isn’t on the map: write latitude (−90 to 90) then longitude (−180 to 180), such as 57.70, 11.97.`;
};
