// `launchApp: { clearState: true }` for a macOS Spark app (docs/e2e-flows.md#clearstate): delete what the app persisted,
// found by reading the Spark and React Native code, and nothing else. Every path is derived from the app's bundle
// identifier or its Spark namespace; nothing is globbed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** `bundleId` is CFBundleIdentifier; `projectId` is SparkProjectIdentifier, which the host falls back to the bundle id for. */
export type AppIdentity = { bundleId: string; projectId: string; sandboxed: boolean };
export type StateHost = {
  home: string;
  /** The app's NSTemporaryDirectory(): the per-user temporary directory of an app that is not sandboxed. */
  temp: string;
  /** Running processes of the app, by bundle identifier. */
  running(bundleId: string): string[];
  /** `defaults delete <domain>`; false when the domain does not exist. */
  deleteDefaults(domain: string): boolean;
};

const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+){2,}$/;

/** `SparkNamespace()` in packages/desktop-app/macos/SparkDesktop.mm: the per-project prefix of Spark's own storage. */
export const sparkNamespace = (projectId: string) => `spark.desktop.${createHash("sha256").update(projectId).digest("hex")}`;

/** Every file and directory clearState deletes, besides the `defaults` domain named by the bundle identifier. */
export function statePaths({ bundleId, projectId }: AppIdentity, { home, temp }: Pick<StateHost, "home" | "temp">): string[] {
  const ns = sparkNamespace(projectId), library = path.join(home, "Library");
  return [
    path.join(library, "Application Support", ns), // settings, file-system "data", SQLite
    path.join(library, "Application Support", bundleId), // React Native AsyncStorage
    path.join(library, "Caches", ns), // file-system "cache"
    path.join(library, "Caches", bundleId), // NSURLCache, Sparkle downloads, WebKit caches
    path.join(library, "HTTPStorages", bundleId), // NSURLSession cookies and HSTS
    path.join(library, "HTTPStorages", `${bundleId}.binarycookies`),
    path.join(library, "Cookies", `${bundleId}.binarycookies`),
    path.join(library, "WebKit", bundleId), // WKWebsiteDataStore.defaultDataStore
    path.join(library, "Saved Application State", `${bundleId}.savedState`), // AppKit window restoration
    path.join(temp, ns), // file-system "temp"
    ...[".setup", ".lock", ".sock"].map(suffix => path.join(temp, `${ns}${suffix}`)), // the single-instance lock
    path.join(temp, "legend-codex-workspace", `codex-home-${bundleId}`), // the codex package's CODEX_HOME
  ];
}

/**
 * Deletes the app's persisted state and returns what existed: the `defaults` domain (as `defaults:<bundle id>`) and
 * the paths of `statePaths`. Refuses an identifier that is not `expected` (the gate manifest's appId) or not a
 * reverse-DNS app identifier, a sandboxed app, and an app that is running.
 */
export function clearAppState(identity: AppIdentity, expected: string, host: StateHost = macHost()): string[] {
  const { bundleId, projectId } = identity;
  if (!BUNDLE_ID.test(bundleId) || bundleId.startsWith("com.apple.")) throw new Error(`clearState refuses bundle identifier "${bundleId}": not an app's reverse-DNS identifier`);
  if (bundleId !== expected) throw new Error(`clearState refuses ${bundleId}: only the gate manifest's app ${expected} may be cleared`);
  if (!projectId.trim()) throw new Error(`clearState refuses ${bundleId}: its Spark project identifier is empty`);
  // Removing another app's container needs the "access data from other apps" permission, which would prompt.
  if (identity.sandboxed) throw new Error(`clearState does not support sandboxed apps: ${bundleId} keeps its state in ~/Library/Containers/${bundleId}`);
  // cfprefsd and the app's open files would write the state back.
  const running = host.running(bundleId);
  if (running.length) throw new Error(`clearState needs ${bundleId} to be quit first; running: ${running.join(", ")}`);
  // Every path below is joined onto these roots; a relative or empty root would delete relative to the working directory.
  for (const [name, root] of [["home", host.home], ["temp", host.temp]] as const) {
    if (!path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) throw new Error(`clearState refuses: the ${name} directory "${root}" is not an absolute, non-root path`);
  }
  const cleared = host.deleteDefaults(bundleId) ? [`defaults:${bundleId}`] : [];
  for (const file of statePaths(identity, host)) {
    if (!lstatSync(file, { throwIfNoEntry: false })) continue;
    rmSync(file, { recursive: true }); // a symbolic link is removed itself, never followed
    cleared.push(file);
  }
  return cleared;
}

function macHost(): StateHost {
  const text = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  };
  return {
    home: os.homedir(),
    temp: text("getconf", ["DARWIN_USER_TEMP_DIR"]).stdout.trim(),
    running: bundleId => text("lsappinfo", ["find", `bundleid=${bundleId}`]).stdout.split("\n").map(line => line.trim()).filter(Boolean),
    deleteDefaults(domain) {
      const result = text("defaults", ["delete", domain]);
      if (result.status === 0) return true;
      if (result.stderr.includes(`Domain '${domain}' not found`)) return false;
      throw new Error(`defaults delete ${domain} failed (${result.status}): ${result.stderr.trim()}`);
    },
  };
}
