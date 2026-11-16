// Where the film shoots. A short list of places with their shoot days: it answers two questions the rest of the
// app asks, how much of the shoot is outside the Los Angeles zone (the California credit pays 5% more on it) and
// what the highest local minimum wage is (the floor for prep, wrap and post days can't sit under it).
//
// Minimum wages (checked Nov 16, 2026): California $17.40 from Jan 1, 2027 (was $16.90 in 2026); City of Los
// Angeles $18.42 since July 1, 2026; unincorporated Los Angeles County $18.47 since July 1, 2026. The city and
// county rates move every July 1, so a post schedule that runs past June wants a little room. dir.ca.gov ·
// wagesla.lacity.gov · dcba.lacounty.gov
import type { Project, ShootLocation } from './types';

export const CA_MIN_WAGE = 17.40;
export const MIN_WAGE_PRESETS: { id: string; label: string; rate: number }[] = [
  { id: 'ca', label: 'California (state rate)', rate: CA_MIN_WAGE },
  { id: 'la-city', label: 'City of Los Angeles', rate: 18.42 },
  { id: 'la-county', label: 'Los Angeles County, unincorporated', rate: 18.47 },
];

let n = 0;
export const newLocation = (partial: Partial<ShootLocation> = {}): ShootLocation =>
  ({ id: `loc_${Date.now().toString(36)}_${(n++).toString(36)}`, name: '', days: 0, outsideLaZone: false, minWage: CA_MIN_WAGE, ...partial });

export const locationsOf = (p: Project): ShootLocation[] => p.locations ?? [];
export const locationDays = (p: Project): number => locationsOf(p).reduce((s, l) => s + Math.max(0, l.days || 0), 0);

/** Share of shoot days outside the Los Angeles zone, 0–100, from the locations list; null when no days are placed. */
export function outOfZonePctFromLocations(p: Project): number | null {
  const total = locationDays(p);
  if (total <= 0) return null;
  const out = locationsOf(p).reduce((s, l) => s + (l.outsideLaZone ? Math.max(0, l.days || 0) : 0), 0);
  return Math.round(out / total * 1000) / 10;
}

/** The highest minimum wage among the places the film works; the state rate when no places are listed. */
export const highestMinWage = (p: Project): number =>
  locationsOf(p).reduce((m, l) => Math.max(m, l.minWage || 0), locationsOf(p).length ? 0 : CA_MIN_WAGE);
