import { useSyncExternalStore } from "react";
import { addDeveloperMenuListener, getDeveloperMenuState, type DeveloperMenuState } from "@legendapp/spark/menus";

const subscribe = (onChange: () => void) => { const subscription = addDeveloperMenuListener(onChange); return () => subscription.remove(); };
export function useDeveloperMenuState(): DeveloperMenuState { return useSyncExternalStore(subscribe, getDeveloperMenuState); }

/** A testID suffix for the state, so driver flows (which select by id) can assert it in any locale. */
export function stateId(state: DeveloperMenuState): string {
  if (state.status === "unavailable") return `unavailable-${state.reason}`;
  if (state.status === "ready") return state.shortcut ? "ready" : "ready-no-shortcut";
  return state.status;
}
/** The state as the API reports it. */
export function stateText(state: DeveloperMenuState): string {
  if (state.status === "unavailable") return `unavailable: ${state.reason}`;
  if (state.status === "ready") return state.shortcutConflict ? `ready: no shortcut (${state.shortcutConflict.shortcut}, ${state.shortcutConflict.with})` : `ready: ${state.shortcut}`;
  if (state.status === "error") return `error: ${state.error instanceof Error ? state.error.message : String(state.error)}`;
  return state.status;
}
