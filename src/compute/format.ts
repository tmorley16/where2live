/** "4 h 54 min", "35 min", "10 h". */
export function fmtDuration(min: number): string {
  if (!Number.isFinite(min)) return '–';
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`;
}

/** Compact "10:09" (hours:minutes). */
export function fmtHM(min: number): string {
  if (!Number.isFinite(min)) return '–';
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Band edges: "9 h", "9 h 30", "45 min". */
export function fmtEdge(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')}`;
}

/** Signed difference: "+31 min", "+1 h 05 min", "best". */
export function fmtDelta(min: number): string {
  if (!Number.isFinite(min)) return '';
  if (Math.round(min) <= 0) return 'best';
  return `+${fmtDuration(min)}`;
}

export function fmtHoursPerYear(minPerWeek: number): string {
  return `${Math.round((minPerWeek / 60) * (365.25 / 7)).toLocaleString('en-AU')} h a year`;
}
