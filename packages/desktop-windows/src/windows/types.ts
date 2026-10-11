import type { ComponentType } from "react";
import type * as Runtimes from "@react-native-runtimes/core";
import type { MenuAction, MenuRootItem } from "@legendapp/spark-native-menu";
import type { HotkeyRouter, RoutedHotkeyHandlers } from "@legendapp/spark-commands/src/router";
import type { HotkeyDefinition } from "@legendapp/spark-commands/src/bindings";
import type { CloseResult, MacOSToolbarOptions, MacOSWindowEvent, WindowOpenOptions } from "../types";

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
  /** Skipped on Windows by definition. */
  macos?: WindowMacOS;
}
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
  phase: "render" | "menu" | "toolbar" | "hotkey" | "runtime" | "cleanup";
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
