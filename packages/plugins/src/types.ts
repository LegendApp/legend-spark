import type { Availability, Subscription } from "@legendapp/spark-desktop-app/src/contracts";

/** The plugin API version this host implements. A manifest naming another version is rejected, never adapted. */
export const PLUGIN_API_VERSION = 1;

/** What a plugin may contribute. The manifest requests capabilities; the host grants them per plugin. */
export type PluginCapability = "commands" | "panels" | "fileTypes" | "menuItems";
/** Every `PluginCapability`, in a fixed order. */
export const PLUGIN_CAPABILITIES: readonly PluginCapability[] = ["commands", "panels", "fileTypes", "menuItems"];

/** JSON data: the only values that cross the boundary between the host and a plugin runtime. */
export type PluginJsonValue = null | boolean | number | string | PluginJsonValue[] | { [key: string]: PluginJsonValue };

/** A plugin's declaration, validated before any of its code runs. */
export interface PluginManifest {
  /** Reverse-DNS identifier, for example `com.example.word-count`. Contribution IDs start with it. */
  id: string;
  name: string;
  /** Semantic version of the plugin, `major.minor.patch`. */
  version: string;
  /** The plugin API version the plugin was written for; must equal {@link PLUGIN_API_VERSION}. */
  apiVersion: number;
  /** Capabilities the plugin needs. Loading fails unless the host grants every one. */
  capabilities: readonly PluginCapability[];
}

/** A command a plugin contributes; its handler is `commands[id]` in the `PluginImplementation`. `title` is 1–200 characters. */
export interface PluginCommand { id: string; title: string }
/** A panel renders the named threaded component (`threadedComponent(name, ...)`, bundled with the plugin) in the plugin's runtime. */
export interface PluginPanel { id: string; title: string; component: string }
/** Files with one of these extensions (lowercase, without the dot) open through `command`, which receives `{ path }`. */
export interface PluginFileType { id: string; name: string; extensions: readonly string[]; command: string }
/** A menu entry a plugin contributes; `command` must be one of the plugin's contributed command IDs. */
export interface PluginMenuItem { id: string; title: string; command: string }

/** Everything a plugin registers when it activates. Each kind needs its capability. */
export interface PluginContributions {
  commands?: readonly PluginCommand[];
  panels?: readonly PluginPanel[];
  fileTypes?: readonly PluginFileType[];
  menuItems?: readonly PluginMenuItem[];
}

/** Passed to a plugin's `activate`. */
export interface PluginActivation { pluginId: string; apiVersion: number }

/** The plugin's side, given to {@link definePlugin}. It runs only in the plugin's isolated runtime. */
export interface PluginImplementation {
  activate?(activation: PluginActivation): PluginContributions | Promise<PluginContributions>;
  /** A handler for every contributed command, keyed by command ID. */
  commands?: Readonly<Record<string, (args: PluginJsonValue) => PluginJsonValue | void | Promise<PluginJsonValue | void>>>;
  deactivate?(): void | Promise<void>;
}

/** The messages a host sends to a plugin entry. */
export type PluginRequest =
  | { kind: "activate"; pluginId: string; apiVersion: number }
  | { kind: "execute"; pluginId: string; command: string; args: PluginJsonValue }
  | { kind: "deactivate"; pluginId: string };
/** A plugin entry's answer: plugin failures are data, so they arrive intact across the runtime boundary. */
export type PluginResponse = { ok: true; value: PluginJsonValue } | { ok: false; error: { name: string; message: string } };

/** What {@link definePlugin} returns. Export it wrapped in `runtimeFunction(...)` so it is bundled as a worker task. */
export type PluginEntryFunction = (request: PluginRequest) => Promise<PluginResponse>;
/** A bundled worker task: `runtimeFunction(definePlugin(...))` from `@react-native-runtimes/core`. */
export type PluginEntry = PluginEntryFunction & { __runtimeFunction?: { id: string } };

/** A plugin the application ships and declares. Only declared plugins can load. */
export interface PluginSource {
  manifest: PluginManifest;
  entry: PluginEntry;
  /** Capabilities the application grants this plugin. */
  grant: readonly PluginCapability[];
}

/** The upstream Runtimes API, supplied by the application so Spark never retains Runtimes itself. */
export interface PluginRuntimeModule {
  ThreadedRuntime: {
    run(runtimeName: string, fn: PluginEntry, request: PluginRequest): Promise<unknown>;
    destroy(runtimeName: string): Promise<void>;
  };
}

/** Options for `createPluginHost`. */
export interface PluginHostOptions {
  /** `import * as Runtimes from "@react-native-runtimes/core"`. */
  runtimes: PluginRuntimeModule;
  plugins: readonly PluginSource[];
  /** Bound for each activation, command and deactivation, 1–2147483647 ms. Default 10000. */
  timeoutMs?: number;
  /** Failures nobody awaits: deactivation errors and throwing listeners. Default `console.error`. */
  onError?(error: unknown, pluginId: string | null): void;
}

/** Lifecycle state of a declared plugin. `failed` keeps the reason in `PluginInfo.error`. */
export type PluginState = "unloaded" | "loading" | "loaded" | "unloading" | "failed";

/** A snapshot of one declared plugin, from `PluginHost.list` or `PluginHost.get`. */
export interface PluginInfo {
  manifest: PluginManifest;
  granted: readonly PluginCapability[];
  state: PluginState;
  /** The plugin's own `@react-native-runtimes/core` runtime; render its panels there. */
  runtimeName: string;
  /** What the plugin registered; empty unless loaded. */
  contributions: Required<PluginContributions>;
  /** Why the last load or call failed, when the state is `failed`. */
  error: { code: string; message: string } | null;
}

/** A loaded plugin's file type that accepts a path, from `PluginHost.findFileHandlers`. */
export interface PluginFileHandler { pluginId: string; fileType: PluginFileType }

/** Manages an application's declared plugins; returned by `createPluginHost`. */
export interface PluginHost {
  /** Every declared plugin, in declaration order. Returns the same array until something changes. */
  list(): readonly PluginInfo[];
  get(pluginId: string): PluginInfo;
  /** Starts the plugin's runtime and activates it. A concurrent load joins; a loaded plugin resolves at once. */
  load(pluginId: string): Promise<PluginInfo>;
  /** Deactivates the plugin, withdraws its contributions and destroys its runtime. */
  unload(pluginId: string): Promise<void>;
  /** Runs a command the plugin contributed. */
  execute(pluginId: string, command: string, args?: PluginJsonValue): Promise<PluginJsonValue>;
  /** Loaded plugins' file types that accept the path's extension, in declaration order. */
  findFileHandlers(path: string): PluginFileHandler[];
  subscribe(listener: () => void): Subscription;
  /** Unloads every plugin; later loads reject `E_CLOSED`. */
  remove(): Promise<void>;
}

export type { Availability };
