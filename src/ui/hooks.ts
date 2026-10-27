import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { resultStore, type Result } from '../compute/engine';
import type { Scenario } from '../domain/types';
import { appStore } from '../state/appStore';
import { scenarioStore } from '../state/scenarioStore';
import { uiStore } from '../state/uiStore';

type UI = ReturnType<typeof uiStore.getState>;
type App = ReturnType<typeof appStore.getState>;

export function useApp<T>(select: (a: App) => T): T {
  return useStore(appStore, select);
}

export function useScenario<T>(select: (s: Scenario | null) => T): T {
  return useStore(scenarioStore, (st) => select(st.scenario));
}

/** For selectors that build a new object or array each time. */
export function useScenarioShallow<T>(select: (s: Scenario | null) => T): T {
  return useStore(scenarioStore, useShallow((st) => select(st.scenario)));
}

export function useUI<T>(select: (u: UI) => T): T {
  return useStore(uiStore, select);
}

export function useResult<T>(select: (r: Result) => T): T {
  return useStore(resultStore, select);
}
