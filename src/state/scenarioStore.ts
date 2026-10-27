import { createStore } from 'zustand/vanilla';
import { parseScenario } from '../domain/validate';
import type { Scenario } from '../domain/types';
import { debounce, loadJSON, saveJSON } from './persist';

/** Saved under a `w2l` key: on GitHub Pages this site shares its origin with the user's other sites. */
const KEY = 'w2l.scenario';
const VERSION = 1;

function load(): Scenario | null {
  const saved = loadJSON<{ v: number; scenario: unknown }>(KEY);
  if (!saved || saved.v !== VERSION) return null;
  return parseScenario(saved.scenario);
}

export const scenarioStore = createStore<{ scenario: Scenario | null }>(() => ({ scenario: load() }));

const save = debounce(() => saveJSON(KEY, { v: VERSION, scenario: scenarioStore.getState().scenario }), 300);
scenarioStore.subscribe(save);
globalThis.addEventListener?.('pagehide', () => save.flush());

export function getScenario(): Scenario | null {
  return scenarioStore.getState().scenario;
}

export function setScenario(scenario: Scenario | null): void {
  scenarioStore.setState({ scenario });
}

/** Change the scenario through a recipe on a copy. */
export function edit(recipe: (draft: Scenario) => void): void {
  const cur = scenarioStore.getState().scenario;
  if (!cur) return;
  const draft = structuredClone(cur);
  recipe(draft);
  scenarioStore.setState({ scenario: draft });
}
