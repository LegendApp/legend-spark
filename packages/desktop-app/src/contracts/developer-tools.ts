import { SparkError, type Subscription } from "./index";

// Internal, development builds only: import this module from `__DEV__` branches so release bundles omit it.
// The Developer menu (@legendapp/spark-native-menu/src/developer-menu) reads it; React Native DevTools (#268)
// registers the opener. Without one, the menu's Open DevTools item is disabled and says why.

/** The JavaScript runtime of the window a developer action targets. */
export type DeveloperRuntimeTarget = { runtime: "shared" } | { runtime: "isolated"; name: string };
export type DevToolsOpener = (target: DeveloperRuntimeTarget) => Promise<void>;

let opener: DevToolsOpener | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch (cause) { console.error(cause); } } };

/** One opener at a time; a second registration rejects E_ALREADY_EXISTS until the first is removed. */
export function registerDevToolsOpener(open: DevToolsOpener): Subscription {
  if (typeof open !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a DevTools opener");
  if (opener) throw new SparkError("E_ALREADY_EXISTS", "A DevTools opener is already registered");
  opener = open;
  notify();
  return { remove() { if (opener === open) { opener = undefined; notify(); } } };
}
export function getDevToolsOpener(): DevToolsOpener | undefined { return opener; }
export function observeDevToolsOpener(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
