import { createStore } from 'zustand/vanilla';
import type { PaletteId } from '../domain/types';
import { loadJSON, saveJSON } from './persist';

/** How the app looks, kept per browser (not in the scenario): 'warm' is friendlier, 'clean' the original cool, plain look. */
export type Look = 'warm' | 'clean';

const LOOK_STORAGE = 'w2l-look';

/** The map colours each look starts new scenarios with. */
export const LOOK_PALETTE: Record<Look, PaletteId> = { warm: 'ylgn', clean: 'ylgnbu' };

function apply(look: Look): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.look = look;
}

const saved = loadJSON<Look>(LOOK_STORAGE);
export const lookStore = createStore<{ look: Look }>(() => ({ look: saved === 'clean' ? 'clean' : 'warm' }));
apply(lookStore.getState().look);

export function setLook(look: Look): void {
  saveJSON(LOOK_STORAGE, look);
  apply(look);
  lookStore.setState({ look });
}
