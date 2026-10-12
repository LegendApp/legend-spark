import { Platform, TurboModuleRegistry } from "react-native";
import { SparkError, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { getWindow, getWindowAvailability, openWarmWindow, pooledWindows, processFootprint, windowPoolCommand } from "../api";
import type { WindowBounds, WindowOpenOptions } from "../types";
import { APPEARANCE_OPTIONS, keys, object } from "../validation";
import type { NavigatorWindowOptions, WindowConfigEntry, WindowErrorEvent, WindowPerformanceFeature, WindowPoolOptions, WindowPoolState } from "./types";

const MB = 1024 * 1024;
/** Defaults chosen for the reference machine, an 8 GB M1 MacBook Air; not yet measured there (docs/api-window-contract.md#window-pools). */
const DEFAULTS: Required<WindowPoolOptions> = { prewarm: 1, max: 2, memoryBudgetMB: 64 };
/** How long a warm window's root may take to render before the window is released. */
const MOUNT_TIMEOUT_MS = 10000;
/** Options a warm window takes when it is opened; anything else needs a new window. */
const TAKEN_OPTIONS = [...APPEARANCE_OPTIONS, "size", "position", "show"];
/** Whether a pooled window could be opened with these options: only such windows are taken from, and returned to, a pool. */
export const poolable = (options: object | undefined) => Object.keys(options ?? {}).every(key => TAKEN_OPTIONS.includes(key));
/** The measured cost is the median of this many recent warm windows, so one outlier cannot empty the pool for good. */
const SAMPLES = 5;

/**
 * `pool`: prewarmed and reused windows with memory budgets; needs @legendapp/spark-system, which reports memory pressure.
 * `throttle`: background render throttling. Both are macOS only for now (Windows: #414).
 */
export function getWindowPerformanceAvailability(feature: WindowPerformanceFeature): Availability {
  if (feature !== "pool" && feature !== "throttle") throw new SparkError("E_INVALID_ARGUMENT", "Unknown window performance feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  const windows = getWindowAvailability();
  if (!windows.available) return windows;
  if (feature === "pool" && !TurboModuleRegistry.get("NativeDesktopSystem")) return { available: false, reason: "missing-module" };
  return { available: true };
}

function count(value: unknown, name: string, max: number) {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max)) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be a whole number from 0 to ${max}`);
}
/** Checks an entry's `pool` and `throttle` registration. */
export function validatePerformance(name: string, entry: WindowConfigEntry) {
  const platform = Platform.OS === "windows" ? "Windows" : Platform.OS;
  if (entry.throttle !== undefined) {
    if (typeof entry.throttle !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "throttle must be boolean");
    if (entry.throttle && Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", `${platform} does not support background render throttling yet`);
  }
  const pool = entry.pool;
  if (pool === undefined) return;
  object(pool, "pool"); keys(pool, ["prewarm", "max", "memoryBudgetMB"]);
  if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", `${platform} does not support window pools yet`);
  if (entry.id !== undefined) throw new SparkError("E_INVALID_ARGUMENT", `${name}: a pooled entry opens a new window each time and cannot have an id`);
  if (entry.runtime !== undefined && entry.runtime !== "shared") throw new SparkError("E_INVALID_ARGUMENT", `${name}: pooled windows render in the shared runtime`);
  count(pool.max, "pool.max", 8);
  count(pool.prewarm, "pool.prewarm", pool.max ?? DEFAULTS.max);
  if (pool.memoryBudgetMB !== undefined && (!Number.isInteger(pool.memoryBudgetMB) || pool.memoryBudgetMB < 1 || pool.memoryBudgetMB > 1024)) throw new SparkError("E_INVALID_ARGUMENT", "pool.memoryBudgetMB must be a whole number from 1 to 1024");
  if ((pool.prewarm ?? DEFAULTS.prewarm) > (pool.max ?? DEFAULTS.max)) throw new SparkError("E_INVALID_ARGUMENT", "pool.prewarm cannot exceed pool.max");
}

let sequence = 0, creations: Promise<void> = Promise.resolve();
/** Generated window IDs: `<name>-<suffix>`. */
export const generatedId = (name: string) => `${name}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;

interface Pool {
  name: string;
  entry: WindowConfigEntry;
  limits: Required<WindowPoolOptions>;
  /** Started by `prewarm`; before that the entry's windows open and close like any other. */
  started: boolean;
  target: number;
  /** Oldest first. */
  warm: string[];
  /** Title and frame each warm window was created with, restored when it is opened. */
  created: Map<string, { title: string; bounds: WindowBounds }>;
  /** Recent warm-window costs in bytes, newest last; reset by `prewarm` and `trimPool`. */
  samples: number[];
  hits: number;
  misses: number;
  released: number;
  filling?: Promise<void>;
}
export interface PoolHost {
  moduleName(name: string): string;
  load(name: string): Promise<unknown>;
  report(event: WindowErrorEvent): void;
}
export type WindowPools = ReturnType<typeof createWindowPools>;

/**
 * The window pools of one navigator. A warm window is an ordinary hidden window whose root is mounted and renders
 * nothing; opening one hands its root the open's props natively, so the next paint is the content. A pooled window
 * that closes parks instead (native: same NSWindow and React surface, a new instance token) and becomes warm again
 * while the limits allow; otherwise it closes for real, which releases the window and its surface.
 */
export function createWindowPools(entries: readonly (readonly [string, WindowConfigEntry])[], host: PoolHost) {
  const pools = new Map<string, Pool>();
  for (const [name, entry] of entries) if (entry.pool) pools.set(name, {
    name, entry, limits: { ...DEFAULTS, ...entry.pool }, started: false, target: 0, warm: [], created: new Map(), samples: [], hits: 0, misses: 0, released: 0,
  });
  /** Every window a started pool owns: warm, being created, or open and parking on close. */
  const known = new Map<string, Pool>();
  const mounting = new Map<string, () => void>();
  /** Closed pooled windows on their way back to warm, which `trim` and `remove` wait for. */
  const recycling = new Set<Promise<void>>();
  const settle = () => Promise.allSettled([...recycling]);
  let pressure = false, removed = false;
  let observing: Promise<AsyncRegistration> | undefined;

  const poolOf = (name: unknown) => {
    const pool = typeof name === "string" ? pools.get(name) : undefined;
    if (!pool) throw new SparkError("E_INVALID_ARGUMENT", `${String(name)} has no pool`);
    return pool;
  };
  const measured = (pool: Pool) => {
    if (!pool.samples.length) return null;
    const sorted = [...pool.samples].sort((a, b) => a - b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const allowed = (pool: Pool) => {
    if (pressure || removed) return 0;
    const cost = measured(pool);
    return Math.min(pool.limits.max, cost ? Math.floor(pool.limits.memoryBudgetMB * MB / cost) : pool.limits.max);
  };
  const cleanupFailed = (pool: Pool, id: string) => (error: unknown) => host.report({ windowId: id, name: pool.name, phase: "cleanup", error });

  /** Closes a pooled window for real; its React surface stops with it. */
  const release = async (pool: Pool, id: string) => {
    known.delete(id); pool.created.delete(id); pooledWindows.delete(id);
    try { await windowPoolCommand("discard", { id }); pool.released++; }
    catch (error) { if (nativeError(error).code !== "E_NOT_FOUND") throw error; }
  };
  /** Releases warm windows past what the limits and memory pressure allow, oldest first. */
  const enforce = async (pool: Pool) => {
    const excess = pool.warm.splice(0, Math.max(0, pool.warm.length - allowed(pool)));
    await Promise.all(excess.map(id => release(pool, id).catch(cleanupFailed(pool, id))));
  };
  const waitForMount = (id: string) => {
    let cancel!: () => void;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { mounting.delete(id); reject(new SparkError("E_TIMEOUT", "A warm window did not render")); }, MOUNT_TIMEOUT_MS);
      cancel = () => { clearTimeout(timer); mounting.delete(id); };
      mounting.set(id, () => { cancel(); resolve(); });
    });
    promise.catch(() => {});
    return { promise, cancel };
  };
  /** Warm windows are created one at a time across all pools, so each measurement sees only its own window. */
  const createWarm = (pool: Pool) => { const run = creations.then(() => createMeasured(pool)); creations = run.catch(() => {}); return run; };
  /** One warm window, measured: the footprint growth from before creating it to its root's first render. Its first use emits windowOpened. */
  const createMeasured = async (pool: Pool) => {
    await host.load(pool.name);
    const id = generatedId(pool.name), mount = waitForMount(id);
    known.set(id, pool); pooledWindows.set(id, false);
    const before = await processFootprint();
    let info;
    try {
      info = await openWarmWindow({ ...pool.entry.options, show: false, id, component: host.moduleName(pool.name), props: { sparkWindow: { id, use: 0 } } } as WindowOpenOptions);
    } catch (error) { mount.cancel(); known.delete(id); pooledWindows.delete(id); throw error; }
    try {
      await windowPoolCommand("pool", { id, enabled: true });
      await mount.promise;
      pool.samples = [...pool.samples, Math.max(0, await processFootprint() - before)].slice(-SAMPLES);
    } catch (error) {
      mount.cancel();
      await release(pool, id).catch(cleanupFailed(pool, id));
      throw error;
    }
    pool.created.set(id, { title: info.title, bounds: info.bounds });
    pool.warm.push(id);
    await enforce(pool);
  };
  /** Creates warm windows up to the target and the limits. */
  const fill = (pool: Pool): Promise<void> => {
    if (pool.filling) return pool.filling;
    const run = (async () => { while (pool.started && pool.warm.length < Math.min(pool.target, allowed(pool))) await createWarm(pool); })();
    pool.filling = run;
    run.then(() => {}, () => {}).then(() => { if (pool.filling === run) pool.filling = undefined; });
    return run;
  };
  const refill = (pool: Pool) => { fill(pool).catch(error => host.report({ windowId: "", name: pool.name, phase: "runtime", error })); };
  const setPressure = (value: boolean) => {
    if (pressure === value) return;
    pressure = value;
    for (const pool of pools.values()) if (value) void enforce(pool); else if (pool.started) refill(pool);
  };
  const observePressure = () => observing ??= (async () => {
    if (!TurboModuleRegistry.get("NativeDesktopSystem")) throw new SparkError("E_MODULE_UNAVAILABLE", "Window pools need the @legendapp/spark-system native module to release warm windows under memory pressure");
    const system = await import("@legendapp/spark-system").catch(cause => {
      throw new SparkError("E_MODULE_UNAVAILABLE", "Window pools need @legendapp/spark-system to release warm windows under memory pressure", { cause });
    });
    const registration = await system.onSystemEvent(event => { if (event.type === "memoryPressure") setPressure(event.level !== "normal"); }, { types: ["memoryPressure"] });
    if (removed) await registration.remove();
    return registration;
  })().catch(error => { observing = undefined; throw error; });
  const state = (pool: Pool): WindowPoolState => ({
    warm: pool.warm.length, target: pool.target, max: pool.limits.max, memoryBudgetMB: pool.limits.memoryBudgetMB,
    measuredWindowMB: measured(pool) === null ? null : Math.round(measured(pool)! / MB * 10) / 10, memoryPressure: pressure,
    hits: pool.hits, misses: pool.misses, released: pool.released,
  });
  const live = () => { if (removed) throw new SparkError("E_CLOSED", "The windows navigator was removed"); };

  return {
    /** Starts the entry's pool and fills it to `count` (default `pool.prewarm`). Windows already open stay outside the pool. */
    async prewarm(name: unknown, requested: unknown): Promise<WindowPoolState> {
      live();
      const pool = poolOf(name);
      count(requested, "count", pool.limits.max);
      await observePressure();
      await settle();
      live();
      pool.target = (requested as number | undefined) ?? pool.limits.prewarm;
      pool.samples = [];
      pool.started = true;
      await fill(pool);
      return state(pool);
    },
    state(name: unknown): WindowPoolState { return state(poolOf(name)); },
    /** Releases warm windows and stops refilling until the next `prewarm`. Closing pooled windows still makes them warm. */
    async trim(name?: unknown) {
      live();
      const targets = name === undefined ? [...pools.values()] : [poolOf(name)];
      for (const pool of targets) { pool.target = 0; pool.samples = []; }
      await settle();
      await Promise.all(targets.map(async pool => {
        await pool.filling?.catch(() => {});
        await Promise.all(pool.warm.splice(0).map(id => release(pool, id)));
      }));
    },
    /**
     * A warm window for this open, if the entry's pool is started and has one, and the open's options are ones a warm
     * window takes. Counts the hit or miss.
     */
    take(name: string, options: NavigatorWindowOptions | undefined): string | undefined {
      const pool = pools.get(name);
      if (!pool?.started || removed) return undefined;
      const id = poolable(options) ? pool.warm.shift() : undefined;
      if (id) pool.hits++; else pool.misses++;
      return id;
    },
    /** The pool has just set this window's options for a new use: changes from here on are the use's own. */
    settled(id: string) { if (pooledWindows.has(id)) pooledWindows.set(id, false); },
    /** The title and frame a warm window was created with. */
    created(id: string) { return known.get(id)?.created.get(id); },
    /** A window opened cold for a started pool parks on close from now on; `opened` is its title and frame to restore on reuse. */
    async track(name: string, id: string, opened: { title: string; bounds: WindowBounds }) {
      const pool = pools.get(name);
      if (!pool?.started || removed) return;
      known.set(id, pool); pooledWindows.set(id, false); pool.created.set(id, { title: opened.title, bounds: opened.bounds });
      await windowPoolCommand("pool", { id, enabled: true });
    },
    /** After an open: tops the entry's pool back up to its target. */
    refill(name: string) { const pool = pools.get(name); if (pool?.started && !removed) refill(pool); },
    /** After a pooled window closed: warm again if it parked and the limits allow, else closed for real. */
    recycle(id: string): Promise<void> {
      const pool = known.get(id);
      // Parked but no pool owns it (opened before a JavaScript reload): close it for real.
      if (!pool) { pooledWindows.delete(id); return getWindow(id).then(() => windowPoolCommand("discard", { id }), error => { if (nativeError(error).code !== "E_NOT_FOUND") throw error; }); }
      const run = (async () => {
        try { await getWindow(id); }
        catch (error) { if (nativeError(error).code === "E_NOT_FOUND") { known.delete(id); pool.created.delete(id); pooledWindows.delete(id); return; } throw error; }
        // A use that changed the window's options (setWindowOptions, blur, toolbar text) would hand them to the next: close it.
        if (pooledWindows.get(id) || pool.warm.length >= allowed(pool)) { await release(pool, id); return; }
        // Unmounts the closed use's content now, so a warm window holds no app state.
        await windowPoolCommand("rootProps", { id, props: { sparkWindow: { id, use: 0 } } });
        pool.warm.push(id);
        await enforce(pool);
      })();
      recycling.add(run);
      void run.then(() => {}, () => {}).then(() => recycling.delete(run));
      return run;
    },
    /** Closes a pooled window for real, whatever its state (a failed open). */
    async release(id: string) { const pool = known.get(id); if (pool) await release(pool, id); else await windowPoolCommand("discard", { id }).catch(error => { if (nativeError(error).code !== "E_NOT_FOUND") throw error; }); },
    /** A warm root rendered. One no pool knows was restarted by a JavaScript reload (or outlived its navigator) and is released. */
    warm(id: string) {
      const mounted = mounting.get(id);
      if (mounted) { mounted(); return; }
      if (known.has(id)) return;
      windowPoolCommand("discard", { id }).catch(error => { if (nativeError(error).code !== "E_NOT_FOUND") host.report({ windowId: id, name: "", phase: "cleanup", error }); });
    },
    /** With the navigator: releases warm windows; open pooled windows stay open and close for real from now on. */
    async remove() {
      removed = true;
      await Promise.all([...pools.values()].map(pool => pool.filling?.catch(() => {})));
      await settle();
      const registration = observing; observing = undefined;
      const results = await Promise.allSettled([
        registration?.then(value => value.remove(), () => {}),
        ...[...pools.values()].flatMap(pool => pool.warm.splice(0).map(id => release(pool, id))),
        ...[...known.keys()].map(id => windowPoolCommand("pool", { id, enabled: false }).catch(error => { if (nativeError(error).code !== "E_NOT_FOUND") throw error; })),
      ]);
      for (const id of known.keys()) pooledWindows.delete(id);
      known.clear();
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
