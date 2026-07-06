/**
 * Attach the run's metric unit to an already-formatted value. Percent hugs
 * the number ("42%"); every other unit gets a space ("412 kB"). A null unit
 * (unitless count, or no report carried one yet) leaves the value bare.
 */
export function withMetricUnit(formatted: string, unit: string | null): string {
  if (!unit) return formatted;
  return unit.startsWith("%") ? `${formatted}${unit}` : `${formatted} ${unit}`;
}
