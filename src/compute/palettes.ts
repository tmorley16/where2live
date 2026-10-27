import type { PaletteId } from '../domain/types';

/** Eight sequential colours, best (least travel) first. All are colour-blind safe. */
export const PALETTES: Record<PaletteId, { label: string; colours: string[] }> = {
  ylgnbu: { label: 'Blue to yellow', colours: ['#0c2c84', '#225ea8', '#1d91c0', '#41b6c4', '#7fcdbb', '#c7e9b4', '#edf8b1', '#ffffd9'] },
  ylgn: { label: 'Green to cream', colours: ['#004529', '#006837', '#238443', '#41ab5d', '#78c679', '#addd8e', '#d9f0a3', '#ffffe5'] },
  viridis: { label: 'Viridis', colours: ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'] },
  magma: { label: 'Magma', colours: ['#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'] },
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** n colours spread across the palette, best first. */
export function bandColours(palette: PaletteId, n: number): string[] {
  const cs = PALETTES[palette].colours;
  if (n <= 1) return [cs[0]];
  return Array.from({ length: n }, (_, k) => cs[Math.round((k * (cs.length - 1)) / (n - 1))]);
}

/** A colour at t ∈ [0, 1] along the palette, linearly blended. */
export function rampColour(palette: PaletteId, t: number): [number, number, number] {
  const cs = PALETTES[palette].colours;
  const x = Math.min(1, Math.max(0, t)) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(cs[i]);
  const b = hexToRgb(cs[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
