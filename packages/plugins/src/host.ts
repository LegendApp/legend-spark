import { NativeModules, Platform } from "react-native";
import { SparkError, type Availability, type Subscription } from "@legendapp/spark-desktop-app/src/contracts";
import { isPluginResponse, validateContributions, validateGrant, validateManifest } from "./validate";
import {
  PLUGIN_API_VERSION, type PluginContributions, type PluginFileHandler, type PluginHost, type PluginHostOptions, type PluginInfo,
  type PluginJsonValue, type PluginRequest, type PluginSource, type PluginState,
} from "./types";

/** A plugin's own failure: its `activate`, command or `deactivate` threw. The plugin's runtime is unaffected. */
export class PluginError extends Error {
  readonly pluginId: string;
  readonly phase: "activate" | "command" | "deactivate";
  /** The `name` of the error the plugin threw. */
  readonly pluginErrorName: string;
  constructor(pluginId: string, phase: PluginError["phase"], error: { name: string; message: string }) {
    super(`${pluginId} (${phase}): ${error.message}`);
    this.name = "PluginError";
    this.pluginId = pluginId;
    this.phase = phase;
    this.pluginErrorName = error.name;
  }
}

/**
 * Plugins run in isolated `@react-native-runtimes/core` runtimes, which Spark has validated on macOS. Windows reports
 * `unsupported-platform` until plugin isolation is verified on its Runtimes backend (#390). Spark targets no other
 * platform; on web, upstream runs "worker" functions on the main heap, which is not isolation.
 */
export function getPluginAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return NativeModules.ThreadedRuntime ? { available: true } : { available: false, reason: "missing-module" };
}

type Record_ = {
  source: PluginSource;
  runtimeName: string;
  state: PluginState;
  contributions: Required<PluginContributions>;
  error: PluginInfo["error"];
  /** Increments on each load, so a late result of an earlier load or call cannot change a newer one. */
  generation: number;
  loading?: Promise<PluginInfo>;
  unloading?: Promise<void>;
  pending: Set<(error: SparkError) => void>;
};

const EMPTY: Required<PluginContributions> = Object.freeze({ commands: [], panels: [], fileTypes: [], menuItems: [] });
const MAX_TIMEOUT = 2147483647;
const describe = (error: unknown) => ({ code: error instanceof SparkError ? error.code : error instanceof PluginError ? "PLUGIN_ERROR" : "E_NATIVE", message: error instanceof Error ? error.message : String(error) });

function validateSource(source: unknown): PluginSource {
  if (!source || typeof source !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Each plugin must be { manifest, entry, grant }");
  const { manifest, entry, grant } = source as PluginSource;
  const valid = validateManifest(manifest);
  // Only a bundled worker task can run: it executes code compiled into the app, never a string, URL or file.
  if (typeof entry !== "function" || typeof entry.__runtimeFunction?.id !== "string") {
    throw new SparkError("E_INVALID_ARGUMENT", `${valid.id}: entry must be a bundled runtimeFunction(definePlugin(...)) export`);
  }
  return { manifest: valid, entry, grant: validateGrant(grant, valid.id) };
}

/**
 * Hosts the plugins an application declares. Each loads into its own isolated runtime; the host validates its manifest,
 * API version and grants before any plugin code runs, and its contributions before they are registered.
 */
export function createPluginHost(options: PluginHostOptions): PluginHost {
  if (!options || typeof options !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Plugin host options are required");
  const { runtimes, plugins, timeoutMs = 10000, onError = (error: unknown) => console.error(error) } = options;
  if (typeof runtimes?.ThreadedRuntime?.run !== "function" || typeof runtimes.ThreadedRuntime.destroy !== "function") {
    throw new SparkError("E_INVALID_ARGUMENT", "Pass the @react-native-runtimes/core module as runtimes");
  }
  if (!Array.isArray(plugins)) throw new SparkError("E_INVALID_ARGUMENT", "plugins must be an array");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) throw new SparkError("E_INVALID_ARGUMENT", `timeoutMs must be an integer from 1 to ${MAX_TIMEOUT}`);
  if (typeof onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "onError must be a function");

  const records = new Map<string, Record_>();
  for (const source of plugins.map(validateSource)) {
    if (records.has(source.manifest.id)) throw new SparkError("E_ALREADY_EXISTS", `Plugin ${source.manifest.id} is declared twice`);
    records.set(source.manifest.id, { source, runtimeName: `spark-plugin.${source.manifest.id}`, state: "unloaded", contributions: EMPTY, error: null, generation: 0, pending: new Set() });
  }
  const listeners = new Set<() => void>();
  let snapshot: readonly PluginInfo[] | undefined;
  let closed = false;

  const report = (error: unknown, pluginId: string | null) => {
    try { onError(error, pluginId); } catch (failure) { console.error(failure); }
  };
  const changed = () => {
    snapshot = undefined;
    for (const listener of [...listeners]) {
      try { listener(); } catch (error) { report(error, null); }
    }
  };
  const info = ({ source, state, runtimeName, contributions, error }: Record_): PluginInfo => ({ manifest: source.manifest, granted: source.grant, state, runtimeName, contributions, error });
  const record = (pluginId: string) => {
    const found = records.get(pluginId);
    if (!found) throw new SparkError("E_NOT_FOUND", `No declared plugin ${String(pluginId)}`);
    return found;
  };
  const set = (target: Record_, state: PluginState, error: unknown = null) => {
    target.state = state;
    target.error = error === null ? null : describe(error);
    if (state !== "loaded") target.contributions = EMPTY;
    changed();
  };
  const destroy = (target: Record_) => runtimes.ThreadedRuntime.destroy(target.runtimeName);
  const closePending = (target: Record_) => {
    for (const reject of [...target.pending]) reject(new SparkError("E_CLOSED", `${target.source.manifest.id} unloaded`));
  };

  /** One bounded call into the plugin's runtime. */
  function call(target: Record_, request: PluginRequest, phase: PluginError["phase"]): Promise<PluginJsonValue> {
    const pluginId = target.source.manifest.id;
    return new Promise<PluginJsonValue>((resolve, reject) => {
      const settle = (done: () => void) => { clearTimeout(timer); target.pending.delete(cancel); done(); };
      const cancel = (error: SparkError) => settle(() => reject(error));
      const timer = setTimeout(() => cancel(new SparkError("E_TIMEOUT", `${pluginId} did not answer ${request.kind} within ${timeoutMs} ms`)), timeoutMs);
      target.pending.add(cancel);
      let running: Promise<unknown>;
      try { running = runtimes.ThreadedRuntime.run(target.runtimeName, target.source.entry, request); }
      catch (error) { running = Promise.reject(error); }
      running.then(response => {
        if (!target.pending.has(cancel)) return;
        if (!isPluginResponse(response)) settle(() => reject(new SparkError("E_INVALID_DATA", `${pluginId} answered ${request.kind} with something other than a plugin response`)));
        else if (response.ok) settle(() => resolve(response.value));
        else { const error = new PluginError(pluginId, phase, response.error); settle(() => reject(error)); }
      }, error => {
        if (target.pending.has(cancel)) settle(() => reject(new SparkError("E_NATIVE", `${pluginId}'s runtime failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })));
      });
    });
  }

  /** The plugin's runtime is unusable (timed out, crashed or answered nonsense): withdraw it and release the runtime. */
  async function fail(target: Record_, generation: number, error: unknown) {
    if (target.generation !== generation || (target.state !== "loaded" && target.state !== "loading")) return;
    closePending(target);
    set(target, "failed", error);
    await destroy(target).catch(cause => report(cause, target.source.manifest.id));
  }

  function load(pluginId: string): Promise<PluginInfo> {
    let target: Record_;
    try {
      if (closed) throw new SparkError("E_CLOSED", "The plugin host was removed");
      target = record(pluginId);
    } catch (error) { return Promise.reject(error); }
    if (target.state === "loaded") return Promise.resolve(info(target));
    if (target.loading) return target.loading;
    const generation = ++target.generation;
    const { manifest, grant } = target.source;
    const loading = (async () => {
      await target.unloading?.catch(() => undefined);
      if (generation !== target.generation) throw new SparkError("E_ABORTED", `${pluginId}: a newer load replaced this one`);
      const availability = getPluginAvailability();
      if (!availability.available) throw new SparkError(availability.reason === "missing-module" ? "E_MODULE_UNAVAILABLE" : "E_UNSUPPORTED_PLATFORM", "Plugins need an isolated runtime, which is unavailable here");
      if (manifest.apiVersion !== PLUGIN_API_VERSION) throw new SparkError("E_UNSUPPORTED_OPTION", `${pluginId} targets plugin API ${manifest.apiVersion}; this host implements ${PLUGIN_API_VERSION}`);
      const missing = manifest.capabilities.filter(capability => !grant.includes(capability));
      if (missing.length) throw new SparkError("E_PERMISSION_DENIED", `${pluginId} needs capabilities the app did not grant: ${missing.join(", ")}`);
      set(target, "loading");
      const value = await call(target, { kind: "activate", pluginId, apiVersion: PLUGIN_API_VERSION }, "activate");
      if (generation !== target.generation || target.state !== "loading") throw new SparkError("E_CLOSED", `${pluginId} unloaded while it loaded`);
      target.contributions = validateContributions(value, manifest);
      set(target, "loaded");
      return info(target);
    })();
    target.loading = loading.catch(async error => {
      if (generation === target.generation && target.state !== "unloading") {
        const started = target.state === "loading";
        closePending(target);
        set(target, "failed", error);
        if (started) await destroy(target).catch(cause => report(cause, pluginId));
      }
      throw error;
    }).finally(() => { if (target.loading === tracked) target.loading = undefined; });
    const tracked = target.loading;
    return tracked;
  }

  function unload(pluginId: string): Promise<void> {
    let target: Record_;
    try { target = record(pluginId); } catch (error) { return Promise.reject(error); }
    if (target.unloading) return target.unloading;
    const loading = target.loading;
    if (target.state !== "loaded" && !loading) return Promise.resolve();
    const unloading = (async () => {
      if (loading) await loading.catch(() => undefined);
      if (target.state !== "loaded") return;
      // Contributions are withdrawn first, so nothing new reaches the plugin while it deactivates.
      set(target, "unloading");
      closePending(target);
      await call(target, { kind: "deactivate", pluginId }, "deactivate").catch(error => report(error, pluginId));
      try { await destroy(target); }
      catch (error) { set(target, "failed", error); throw error; }
      set(target, "unloaded");
    })();
    target.unloading = unloading.finally(() => { if (target.unloading === tracked) target.unloading = undefined; });
    const tracked = target.unloading;
    return tracked;
  }

  async function execute(pluginId: string, command: string, args: PluginJsonValue = null): Promise<PluginJsonValue> {
    const target = record(pluginId);
    if (target.state !== "loaded") throw new SparkError("E_CLOSED", `${pluginId} is not loaded`);
    if (!target.contributions.commands.some(item => item.id === command)) throw new SparkError("E_NOT_FOUND", `${pluginId} has no command ${String(command)}`);
    try { JSON.stringify(args); } catch (cause) { throw new SparkError("E_INVALID_ARGUMENT", "Command arguments must be JSON", { cause }); }
    const generation = target.generation;
    try { return await call(target, { kind: "execute", pluginId, command, args }, "command"); }
    catch (error) {
      if (!(error instanceof PluginError) && !(error instanceof SparkError && error.code === "E_CLOSED")) await fail(target, generation, error);
      throw error;
    }
  }

  return {
    list: () => snapshot ??= [...records.values()].map(info),
    get: pluginId => info(record(pluginId)),
    load,
    unload,
    execute,
    findFileHandlers(path) {
      if (typeof path !== "string") throw new SparkError("E_INVALID_ARGUMENT", "path must be a string");
      const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
      const dot = name.lastIndexOf(".");
      if (dot <= 0) return [];
      const extension = name.slice(dot + 1).toLowerCase();
      const handlers: PluginFileHandler[] = [];
      for (const target of records.values()) {
        if (target.state !== "loaded") continue;
        for (const fileType of target.contributions.fileTypes) if (fileType.extensions.includes(extension)) handlers.push({ pluginId: target.source.manifest.id, fileType });
      }
      return handlers;
    },
    subscribe(listener): Subscription {
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "listener must be a function");
      const entry = () => listener();
      listeners.add(entry);
      return { remove: () => { listeners.delete(entry); } };
    },
    async remove() {
      closed = true;
      const results = await Promise.allSettled([...records.keys()].map(unload));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
