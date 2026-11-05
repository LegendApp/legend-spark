import { realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { installedPackages, nativePackages, type Package, type NativePackage, type Runtime } from "./project.ts";
import { isExpoProject } from "@legendapp/spark-desktop-config/config.cjs";

type RuntimeInputs = { native: NativePackage[]; development?: Runtime };

/** Native compatibility inputs stay stable until a source or resolution path changes. */
export function createRuntimeInputCache(root: string) {
  let value: RuntimeInputs | undefined;
  let dirty = true;
  let disabled = false;
  let watchers: FSWatcher[] = [];
  let resolutionPaths = new Map<string, string | null>();
  let observedRoots = "";
  let readiness: ReturnType<typeof setImmediate> | undefined;
  function identity(location: string) {
    try {
      const stat = statSync(location, { throwIfNoEntry: false });
      return stat ? `${stat.dev}:${stat.ino}` : null;
    } catch (error: any) {
      if (error.code === "ENOTDIR") return null;
      throw error;
    }
  }
  function stop() {
    clearImmediate(readiness);
    readiness = undefined;
    for (const watcher of watchers) watcher.close();
    watchers = [];
  }
  const invalidate = () => { dirty = true; };
  function fail() {
    disabled = true;
    dirty = true;
    stop();
  }
  const calculate = (): RuntimeInputs => ({ native: nativePackages(root) });
  function observe(installed: Package[]) {
    const realRoot = realpathSync(root);
    const requested = new Map<string, boolean>();
    const add = (location: string, recursive: boolean) => {
      const directory = realpathSync(location);
      requested.set(directory, recursive || requested.get(directory) || false);
    };
    const paths = new Map<string, string | null>();
    for (const pkg of [{ root, json: {} }, ...installed]) {
      add(pkg.root, true);
      add(path.dirname(pkg.root), false);
      const context = path.join(pkg.root, pkg.json.spark?.bundledModuleRoot ?? ".", "package.json");
      for (const search of createRequire(context).resolve.paths("__spark_runtime_inputs__") ?? []) {
        if (!paths.has(search)) {
          const current = identity(search);
          paths.set(search, current);
          if (current !== null) add(search, true);
        }
      }
    }
    const recursiveRoots = [...requested].filter(([, recursive]) => recursive).map(([directory]) => directory);
    const roots = [...requested].filter(([directory]) => !recursiveRoots.some(parent => parent !== directory && directory.startsWith(parent + path.sep)));
    const key = JSON.stringify(roots.map(([directory, recursive]) => [directory, recursive, identity(directory)]));
    if (key === observedRoots) { resolutionPaths = paths; return; }
    const next: FSWatcher[] = [];
    try {
      for (const [directory, recursive] of roots) {
        const watcher = watch(directory, { recursive }, (_event, filename) => {
          const relative = filename === null ? null : path.relative(realRoot, path.join(directory, String(filename))).split(path.sep).join("/");
          // Session status is output of the check, never an input to it.
          if (relative && /^\.spark\/(?:platforms\/[^/]+\/)?session\.json(?:\.\d+\.tmp)?$/.test(relative)) return;
          invalidate();
        });
        watcher.on("error", fail);
        next.push(watcher);
      }
    } catch {
      for (const watcher of next) watcher.close();
      fail();
      return;
    }
    stop();
    watchers = next;
    resolutionPaths = paths;
    observedRoots = key;
    // A watch may start asynchronously. Recheck after its first event-loop turn.
    readiness = setImmediate(() => { readiness = undefined; invalidate(); });
  }
  return {
    invalidate,
    read(): RuntimeInputs {
      // Expo configuration can depend on arbitrary external modules or environment.
      if (disabled || isExpoProject(root)) return calculate();
      if (!dirty) {
        try {
          // Installs can replace a watched directory before its event is delivered.
          for (const [location, previous] of resolutionPaths) {
            if (identity(location) !== previous) { dirty = true; break; }
          }
        } catch { fail(); return calculate(); }
        if (!dirty) return value!;
      }
      dirty = false;
      try {
        const installed = installedPackages(root);
        try { observe(installed); } catch { fail(); }
        value = calculate();
        // A concurrent graph change needs a fresh set of source watches next poll.
        if (JSON.stringify(installed) !== JSON.stringify(installedPackages(root))) dirty = true;
        return value;
      } catch (error) {
        dirty = true;
        throw error;
      }
    },
    close() { disabled = true; stop(); },
  };
}
