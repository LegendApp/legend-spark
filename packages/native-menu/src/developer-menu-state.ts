import { SparkError, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";

// Public state of the development-only Developer menu. This module holds no menu code: release bundles keep it
// and report `release-build`, while the menu itself (developer-menu.ts) is compiled out.

/** A binding that kept the Developer menu from claiming its shortcut. */
export interface DeveloperMenuShortcutConflict { shortcut: string; with: "system" | "menu" | "shortcut" | "global-shortcut"; description: string }
/** State of the development-only Developer menu, from `getDeveloperMenuState` and `addDeveloperMenuListener`. */
export type DeveloperMenuState =
  /**
   * `release-build`: the JavaScript bundle was built without `__DEV__`. `not-installed`: the app entry does not require
   * `@legendapp/spark/runtime-entry`, which installs the menu. The others are the menu module's availability.
   */
  | { status: "unavailable"; reason: "release-build" | "not-installed" | "unsupported-platform" | "missing-module" | "host-restriction" }
  | { status: "installing" }
  /** `shortcut` is null when another binding owns it; `shortcutConflict` names that binding. */
  | { status: "ready"; shortcut: string | null; shortcutConflict?: DeveloperMenuShortcutConflict }
  | { status: "error"; error: unknown };

// Metro inlines __DEV__; declared here so consumers type-check without React Native's globals.
declare const __DEV__: boolean;
let state: DeveloperMenuState | undefined;
const listeners = new Set<(state: DeveloperMenuState) => void>();

/** Returns the same object until the state changes, so it can be a useSyncExternalStore snapshot. */
export function getDeveloperMenuState(): DeveloperMenuState {
  return state ??= { status: "unavailable", reason: __DEV__ ? "not-installed" : "release-build" };
}
/** Calls `listener` with each new Developer menu state. Throws `E_INVALID_ARGUMENT` when `listener` is not a function. */
export function addDeveloperMenuListener(listener: (state: DeveloperMenuState) => void): Subscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a Developer menu listener");
  listeners.add(listener);
  return { remove() { listeners.delete(listener); } };
}
/** Internal: the Developer menu reports its lifecycle here. */
export function setDeveloperMenuState(next: DeveloperMenuState): void {
  state = next;
  for (const listener of [...listeners]) {
    try { listener(next); } catch (cause) { console.error(cause); }
  }
}
