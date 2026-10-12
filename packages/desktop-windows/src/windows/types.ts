import type { ComponentType } from "react";
import type * as Runtimes from "@react-native-runtimes/core";
import type { MenuAction, MenuRootItem } from "@legendapp/spark-native-menu";
import type { HotkeyRouter, RoutedHotkeyHandlers } from "@legendapp/spark-commands/src/router";
import type { HotkeyDefinition } from "@legendapp/spark-commands/src/bindings";
import type { CloseResult, MacOSToolbarOptions, MacOSWindowEvent, WindowBounds, WindowId, WindowOpenOptions } from "../types";

type WithoutIdentity<T> = T extends unknown ? Omit<T, "id" | "component" | "props"> : never;
export type NavigatorWindowOptions = WithoutIdentity<WindowOpenOptions>;

/** The upstream Runtimes module, supplied by the app so Spark never retains Runtimes itself. */
export type IsolatedRuntimeModule = Pick<typeof Runtimes, "Threaded" | "ThreadedRuntime">;
/** Render the window in a named `@react-native-runtimes/core` runtime. Entries naming one runtime share its heap. */
export interface IsolatedRuntime { isolated: string; module: IsolatedRuntimeModule }

/** A navigator-owned window. Handles stay valid after closing; `isOpen()` reports the live state. */
export interface WindowInstance {
  readonly id: string;
  /** The navigator entry name. */
  readonly name: string;
  readonly runtime: "shared" | "isolated";
  /** This window's undo history; never shared with another window. */
  readonly undo: UndoStack;
  isOpen(): boolean;
  focus(): Promise<void>;
  close(): Promise<CloseResult>;
  /** Republishes this window's menus when it is the key window. */
  refreshMenus(): Promise<void>;
  /** Re-applies the entry's macOS toolbar. Resolves without change on Windows. */
  refreshToolbar(): Promise<void>;
}

export interface UndoEntry { label?: string; undo(): void; redo(): void }
export interface UndoState { readonly canUndo: boolean; readonly canRedo: boolean; readonly undoLabel: string | null; readonly redoLabel: string | null }
export interface UndoStack {
  /** Records an already-applied change and clears the redo history. Keeps the latest 100 entries. */
  push(entry: UndoEntry): void;
  /** Returns false when nothing can be undone. A throwing entry stays on its stack. */
  undo(): boolean;
  redo(): boolean;
  clear(): void;
  /** Stable snapshot; a new object only after a change. */
  getState(): UndoState;
  subscribe(listener: (state: UndoState) => void): { remove(): void };
}

export interface WindowHotkeys<Id extends string = string> {
  definitions: readonly HotkeyDefinition<Id>[];
  handlers: (instance: WindowInstance) => RoutedHotkeyHandlers<Id>;
}
export interface WindowMacOS {
  toolbar?: (instance: WindowInstance) => MacOSToolbarOptions;
  onToolbarEvent?: (event: MacOSWindowEvent, instance: WindowInstance) => void;
}
interface WindowServices {
  options?: NavigatorWindowOptions;
  /** Defaults to the shared JavaScript runtime. Isolated entries render a `threadedComponent`. */
  runtime?: "shared" | IsolatedRuntime;
  /** Bind Edit ▸ Undo/Redo to this window's undo stack while it is key. */
  undoMenu?: boolean;
  menus?: (instance: WindowInstance) => readonly MenuRootItem[];
  onMenuAction?: (action: MenuAction, instance: WindowInstance) => void | Promise<void>;
  hotkeys?: WindowHotkeys;
  /**
   * The tab bar's + button, and the `newTab` menu role while the window is key: returns the window to
   * open as the group's new last tab. The entry it names must not have a fixed `id`. macOS only for now.
   */
  newTab?: (instance: WindowInstance) => NewWindowTabRequest | Promise<NewWindowTabRequest>;
  /** Skipped on Windows by definition. */
  macos?: WindowMacOS;
  /**
   * Keep hidden, already rendered windows of this entry ready, so `open` only hands them props and shows them.
   * Needs an entry without `id` in the shared runtime. macOS only for now (Windows throws E_UNSUPPORTED_OPTION, so shared
   * configurations add it conditionally); see `getWindowPerformanceAvailability('pool')`.
   */
  pool?: WindowPoolOptions;
  /**
   * Background render throttling: while the window is hidden, minimized or fully covered, its content does not re-render;
   * its views are hidden and layout effects cleaned up, state is kept, and pending updates render once when it is visible
   * again. macOS only for now: Windows throws E_UNSUPPORTED_OPTION, so shared configurations add it conditionally.
   */
  throttle?: boolean;
}
/** Per-entry window pool limits. Warm windows are created by `prewarm` and by closing pooled windows. */
export interface WindowPoolOptions {
  /** How many warm windows `prewarm` creates and the pool refills to after each open. 0–`max`; default 1. */
  prewarm?: number;
  /** The most warm windows kept. 0–8; default 2. */
  max?: number;
  /**
   * The most memory this entry's warm windows may hold, in MB (1–1024; default 64). Each warm window's cost is the growth
   * of the process footprint while it was created; the pool keeps no more warm windows than fit the median recent cost.
   */
  memoryBudgetMB?: number;
}
/** What `getPool` reports. Counters run for the navigator's lifetime. */
export interface WindowPoolState {
  /** Warm windows ready now. */
  warm: number;
  /** What `prewarm` asked for; 0 before it and after `trimPool`. */
  target: number;
  max: number;
  memoryBudgetMB: number;
  /** The median footprint growth of the last five warm windows created, in MB; null before the first (or since prewarm or trimPool). */
  measuredWindowMB: number | null;
  /** True between memory pressure (warning or critical) and its return to normal: no warm windows are kept. */
  memoryPressure: boolean;
  /** Opens served by a warm window. */
  hits: number;
  /** Opens that created a window: none was warm, or the open needed options a warm window cannot take. */
  misses: number;
  /** Warm windows closed for real: over `max` or the budget, trimmed, under memory pressure, or the navigator was removed. */
  released: number;
}
/** `pool`: window pools (prewarm, reuse, memory budgets). `throttle`: background render throttling. */
export type WindowPerformanceFeature = "pool" | "throttle";
/** What `newTab` returns; `createWindowsNavigator` checks `name` and `props` against the configuration. */
export interface NewWindowTabRequest { name: string; props?: unknown; options?: NavigatorWindowOptions }
type OpenRequestFor<P> = {} extends P ? { props?: P; options?: NavigatorWindowOptions } : { props: P; options?: NavigatorWindowOptions };
/** A `newTab` result for one of the configuration's entries, with that entry's props. */
export type NewWindowTab<T extends WindowsConfig> = { [K in keyof T & string]: { name: K } & OpenRequestFor<WindowComponentProps<T[K]>> }[keyof T & string];
export type WindowComponentLoader<P = Record<string, never>> = () => ComponentType<P> | { default: ComponentType<P> } | Promise<ComponentType<P> | { default: ComponentType<P> }>;
/** Any React component, whatever its props; `open` infers the props from the registered component. */
export type WindowComponent = ((props: never) => unknown) | (abstract new (props: never) => unknown);
type Loaded<C> = C | { default: C };
/**
 * `id` makes the entry a singleton with that window ID. Without `id`, every open creates a new
 * window with a generated ID. Pass `P` to check the component's props.
 */
export type WindowConfigEntry<P = never> = WindowServices & { id?: string } & ([P] extends [never]
  ? { component: WindowComponent; loadComponent?: never } | { component?: never; loadComponent: () => Loaded<WindowComponent> | Promise<Loaded<WindowComponent>> }
  : { component: ComponentType<P>; loadComponent?: never } | { component?: never; loadComponent: WindowComponentLoader<P> });
export type WindowsConfig = Record<string, WindowConfigEntry>;
type PropsOf<C> = C extends { default: infer D } ? PropsOf<D> : C extends ComponentType<infer P> ? P : never;
export type WindowComponentProps<T> = T extends { component: infer C } ? PropsOf<C> : T extends { loadComponent: () => infer R } ? PropsOf<Awaited<R>> : never;

export interface WindowErrorEvent {
  windowId: string;
  name: string;
  phase: "render" | "menu" | "toolbar" | "hotkey" | "newTab" | "runtime" | "cleanup";
  /** Render and handler failures are application errors; native failures are SparkErrors. */
  error: unknown;
}
export interface ErrorFallbackProps { windowId: string; error: unknown; retry(): void; close(): void }
export interface UndoMenuLabels { edit: string; undo: (label: string | null) => string; redo: (label: string | null) => string }
export interface WindowsNavigatorOptions {
  /** Required when an entry declares hotkeys. */
  hotkeys?: HotkeyRouter;
  undoLabels?: UndoMenuLabels;
  errorFallback?: ComponentType<ErrorFallbackProps>;
  /** Defaults to console.error. */
  onError?: (event: WindowErrorEvent) => void;
}

/** `tabs`: tab groups in sessions and `duplicate` with `tab`. */
export type WindowSessionFeature = "tabs";
/** One window of a `WindowSession`. Plain JSON, for the app to store where it likes. */
export interface SavedWindow {
  id: WindowId;
  /** The navigator entry. */
  name: string;
  /** Null for a window opened without props. */
  props: Record<string, unknown> | null;
  title: string;
  visible: boolean;
  /** The frame, and the display's `persistentId` (null when it has none) to find it again after displays change. */
  bounds: WindowBounds & { persistentDisplayId: string | null };
  /** Restorable window state by restoration key. */
  state: Record<string, unknown>;
}
/** A tab group of saved windows, in tab order. macOS only. */
export interface SavedTabGroup { windowIds: WindowId[]; selectedWindowId: WindowId | null }
/** What `getSession` saves and `restoreSession` opens again. */
export interface WindowSession {
  version: 1;
  /** In opening order. */
  windows: SavedWindow[];
  /** Groups of two or more saved windows. Always empty on Windows. */
  tabGroups: SavedTabGroup[];
  keyWindowId: WindowId | null;
}
export interface DuplicateWindowOptions {
  /** Shallowly merged over the source's props. */
  props?: Record<string, unknown>;
  /** Over the source's title and cascaded frame. */
  options?: NavigatorWindowOptions;
  /** Copy app-scoped values the source is attached to (restorable states only) instead of sharing them. */
  detached?: boolean;
  /** Open as the next tab of the source's tab group instead of a cascaded window. macOS only for now. */
  tab?: boolean;
}
