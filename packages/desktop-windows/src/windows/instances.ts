import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { jsonSnapshot } from "../validation";
import type { WindowInstance } from "./types";

/** How a window state starts in a window opened by `restoreSession` or `duplicate`. */
export type StateSeed = { value: unknown } | { attach: string };

/** What window state, messages and the navigator share about one navigator window. Internal. */
export interface InstanceRecord {
  readonly disposed: boolean;
  /** Called once when the window closes or its navigator is removed. */
  readonly closeListeners: Set<() => void>;
  /** Initial values for window states from `duplicate`, consumed on each state's first access. */
  readonly seeds: Map<WindowStateInternals, StateSeed>;
  /**
   * Saved values by restoration key from `restoreSession`, consumed the same way. A key whose state
   * is not created yet (a lazily loaded module) keeps its value, so sessions never drop it.
   */
  readonly restored: Map<string, unknown>;
  /** Tells the window's navigator that its session changed. */
  sessionChanged(): void;
}

/** The parts of a `createWindowState` the navigator uses for sessions and duplication. Internal. */
export interface WindowStateInternals {
  readonly restorationKey: string | undefined;
  /** A JSON copy of the window's private value; undefined while it has none or is attached. */
  snapshot(window: WindowInstance): unknown;
  /** How a duplicate of the window starts: attached to the same app value, or with a copy of its value. */
  duplicate(window: WindowInstance, detached: boolean): StateSeed | undefined;
}

const records = new WeakMap<WindowInstance, InstanceRecord>();
/** Every live window state; restorable ones also by key. */
export const windowStates = new Set<WindowStateInternals>();
export const restorableStates = new Map<string, WindowStateInternals>();

export function registerInstance(instance: WindowInstance, record: InstanceRecord) { records.set(instance, record); }
export function instanceRecord(window: WindowInstance): InstanceRecord {
  const record = records.get(window);
  if (!record) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window instance from createWindowsNavigator");
  return record;
}
/** True once a navigator window has closed. Rejects values that are not navigator windows. */
export function isClosedWindow(window: WindowInstance): boolean { return instanceRecord(window).disposed; }

/** A JSON copy, rejecting values JSON cannot carry instead of dropping them. */
export function jsonCopy(value: unknown, what: string): unknown {
  try { return jsonSnapshot(value); }
  catch (cause) { throw new SparkError("E_INVALID_DATA", `${what} must be finite, acyclic JSON`, { cause }); }
}
